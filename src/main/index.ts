import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  shell,
  Tray,
} from 'electron'
import type { AppState, ProposedAction, SettingsPatch, Topic } from '../shared/types'
import type { CallPatch } from '../shared/calls'
import { Calls } from './calls/service'
import { Flux } from './engine/poller'
import { Daily } from './llm/daily'
import { CONFIG } from './config'
import { Triage } from './llm/triage'
import { checkCalendarUrl, checkGithub, checkJira, checkLinearKey, normalizeJiraSite } from './onboarding'
import { ARCHIVE_DIR, THREADS_DIR, TOPICS_DIR } from './paths'
import { fetchCalendar, fetchCalendarBetween } from './sources/calendar'
import { GITHUB_HOST, listGithubAccounts } from './sources/github'
import { fetchJira } from './sources/jira'
import { fetchLinear } from './sources/linear'
import { SettingsStore } from './store/settings'
import { noteFromText, TopicStore } from './store/topics'
import { closeThreads } from './threads/close'
import { adoptThreads } from './threads/desktop'
import { goToThread, launchThread } from './threads/launch'
import { resolveWorkspace } from './workspaces'

const THREAD_SETTLE_MS = 6_000

let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
let tray: Tray | null = null
let flux: Flux
let settings: SettingsStore
let daily: Daily
let calls: Calls
const liveNotifications = new Set<Notification>()

function pageUrl(hash = ''): { url?: string; file?: string } {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return { url: `${dev}${hash}` }
  return { file: join(__dirname, '../renderer/index.html') }
}

function load(window: BrowserWindow, hash = ''): void {
  const { url, file } = pageUrl(hash)
  if (url) void window.loadURL(url)
  else if (file) void window.loadFile(file, { hash: hash.replace('#', '') })
}

function openMain(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 25 },
    backgroundColor: '#070912',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })
  window.once('ready-to-show', () => window.show())
  // ⌘R refreshes Flux's sources instead of reloading the window
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.meta && !input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault()
      window.webContents.send('flux:refresh-shortcut')
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(window)
  mainWindow = window
  return window
}

function openCapture(): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.show()
    captureWindow.focus()
    return
  }
  const window = new BrowserWindow({
    width: 560,
    height: 190,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    vibrancy: 'hud',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })
  window.on('blur', () => window.close())
  window.on('closed', () => {
    if (captureWindow === window) captureWindow = null
  })
  load(window, '#capture')
  captureWindow = window
}

function showTopic(id: string): void {
  const window = openMain()
  const send = () => window.webContents.send('flux:open-topic', id)
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}

function trayLabel(state: AppState): string {
  const head = state.queue[0]
  if (!head) return '✓'
  const ref = head.topic.links[0] ?? head.topic.title
  const short = ref.length > 24 ? `${ref.slice(0, 23)}…` : ref
  return `▶ ${state.queue.length}  ${short}`
}

function buildTray(): void {
  tray = new Tray(nativeImage.createEmpty())
  tray.setTitle('Flux')
  tray.setToolTip('Flux')
  tray.on('click', () => {
    const head = flux.current()?.queue[0]
    if (head) showTopic(head.topic.id)
    else openMain()
  })
  tray.on('right-click', () => {
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Ouvrir Flux', click: () => openMain() },
        { label: 'Nouvelle note', click: () => openCapture() },
        { label: 'Rafraîchir', click: () => void flux.refresh() },
        { type: 'separator' },
        { label: 'Quitter', role: 'quit' },
      ]),
    )
  })
}

function registerCapture(): void {
  globalShortcut.unregisterAll()
  const accelerator = settings.values.captureShortcut
  if (accelerator) globalShortcut.register(accelerator, openCapture)
}

function notify(title: string, body: string, onClick: () => void): void {
  const notification = new Notification({ title, body, silent: false })
  liveNotifications.add(notification)
  notification.on('click', () => {
    liveNotifications.delete(notification)
    onClick()
  })
  notification.on('close', () => liveNotifications.delete(notification))
  notification.show()
}

function notifyDaily(): void {
  notify('Daily prêt', 'Le récap du jour t’attend dans Flux.', () => {
    openMain().webContents.send('flux:open-daily-view')
  })
}

function requireTopic(id: string): Topic {
  const topic = flux.topic(id)
  if (!topic) throw new Error(`Sujet introuvable : ${id}`)
  return topic
}

function registerIpc(): void {
  ipcMain.handle('flux:get-state', () => flux.current())
  ipcMain.handle('flux:refresh', async () => {
    await Promise.all([flux.refresh(), calls.sync()])
  })
  ipcMain.handle('flux:create-note', async (_event, text: string) => {
    if (text.trim()) await flux.addTopic(noteFromText(text, new Date()))
    captureWindow?.close()
  })
  ipcMain.handle('flux:open-capture', () => openCapture())
  ipcMain.handle('flux:close-capture', () => captureWindow?.close())
  ipcMain.handle('flux:update-topic', async (_event, id: string, patch: Partial<Topic>) => {
    const topic = requireTopic(id)
    Object.assign(topic, patch)
    await flux.saveTopic(topic)
  })
  ipcMain.handle('flux:close-topic', (_event, id: string) => flux.closeTopic(id))
  ipcMain.handle('flux:launch-thread', async (_event, id: string, action: ProposedAction) => {
    const view = flux.view(id)
    if (!view) throw new Error(`Sujet introuvable : ${id}`)
    const topic = requireTopic(id)
    topic.threads.push(await launchThread(view, action))
    if (topic.status === 'inbox') topic.status = 'open'
    await flux.saveTopic(topic)
    setTimeout(() => void flux.refresh(), THREAD_SETTLE_MS)
  })
  ipcMain.handle('flux:focus-thread', async (_event, id: string, session: string) => {
    const topic = requireTopic(id)
    await flux.adoptThreads()
    const thread = topic.threads.find(entry => entry.session === session || entry.dir === session)
    if (!thread) throw new Error(`Thread introuvable : ${session}`)
    const alive = flux.liveSessions().some(entry => entry.session === thread.session)
    const workspace = await goToThread(thread, alive)
    if (workspace !== thread.workspace) {
      thread.workspace = workspace
      await flux.saveTopic(topic)
    }
    setTimeout(() => void flux.refresh(), THREAD_SETTLE_MS)
  })
  ipcMain.handle('flux:open-external', (_event, url: string) => {
    if (/^https?:/i.test(url)) return shell.openExternal(url)
    return undefined
  })
  ipcMain.handle('flux:get-settings', () => settings.public())
  ipcMain.handle('flux:save-settings', async (_event, patch: SettingsPatch) => {
    settings.apply(
      patch.jiraSite === undefined ? patch : { ...patch, jiraSite: normalizeJiraSite(patch.jiraSite) },
    )
    // A workspace switch only redraws from the cache; nothing else needs reloading
    if (Object.keys(patch).every(key => key === 'workspace')) {
      // The Daily tab follows the workspace: PP's note in PP, CC's in CC
      daily.sync(new Date())
      void flux.switchWorkspace()
      return
    }
    registerCapture()
    // The panel closes as soon as settings are written; sources reload in the background
    void flux.reloadSources()
  })
  ipcMain.handle('flux:test-notification', () => {
    notify('Flux', 'Les notifications arrivent bien.', () => openMain())
  })
  ipcMain.handle('flux:check-github', () => checkGithub(settings.values.githubAccount))
  ipcMain.handle('flux:github-accounts', async () => ({
    host: GITHUB_HOST,
    ...(await listGithubAccounts()),
  }))
  ipcMain.handle('flux:check-linear-key', (_event, key: string) => checkLinearKey(key))
  ipcMain.handle('flux:check-jira', (_event, site: string, email: string, token: string) =>
    checkJira(site, email, token),
  )
  ipcMain.handle('flux:check-calendar-url', (_event, url: string) => checkCalendarUrl(url))
  ipcMain.handle('flux:get-calls', () => calls.state())
  ipcMain.handle('flux:update-call', (_event, id: string, patch: CallPatch) => calls.update(id, patch))
  ipcMain.handle('flux:sync-calls', () => calls.sync())
  ipcMain.handle('flux:connect-granola', () => calls.connect(url => void shell.openExternal(url)))
  ipcMain.handle('flux:disconnect-granola', () => calls.disconnect())
  ipcMain.handle('flux:run-daily', () => daily.run(new Date()))
  ipcMain.handle('flux:read-daily', () => daily.read(new Date()))
  ipcMain.handle('flux:open-daily', () => {
    const path = daily.notePath(new Date())
    return path ? shell.openExternal(`obsidian://open?path=${encodeURIComponent(path)}`) : undefined
  })
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  await app.whenReady()
  settings = new SettingsStore()
  const triage = new Triage()
  daily = new Daily({
    publish: state => flux.setDaily(state),
    onReady: () => notifyDaily(),
    fetchMeetings: async (from, to) => {
      const url = settings.secret('calendarUrl')
      return url && settings.calendar() ? fetchCalendarBetween(url, from, to) : null
    },
    snapshot: (workspace, now) => flux.workspaceSnapshot(workspace, now),
    activeWorkspace: () => resolveWorkspace(CONFIG.workspaces, settings.values.workspace),
  })
  calls = new Calls(settings, state => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('flux:calls', state)
  })
  const store = new TopicStore(TOPICS_DIR, ARCHIVE_DIR)
  flux = new Flux(store, settings, {
    onState(state) {
      tray?.setTitle(trayLabel(state))
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('flux:state', state)
      }
    },
    onNotify: ({ title, body, topicId }) => notify(title, body, () => showTopic(topicId)),
    fetchTickets: async keys => {
      const key = settings.secret('linearKey')
      if (!key || !settings.uses('linear')) return null
      const tickets = await fetchLinear(key, keys)
      await triage.apply(tickets)
      return tickets
    },
    fetchJira: async (keys, projects) => {
      const token = settings.secret('jiraToken')
      const email = settings.values.jiraEmail
      const site = settings.jiraSite()
      if (!settings.uses('jira') || !site || !email || !token) return null
      // Without workspaces, every project you are assigned in counts
      return fetchJira({ site, email, token }, projects, keys)
    },
    fetchMeetings: async () => {
      const url = settings.secret('calendarUrl')
      return url && settings.calendar() ? fetchCalendar(url) : null
    },
    closeThreads: topic => closeThreads(topic, flux.liveSessions()),
    adoptThreads: topics => adoptThreads(topics, THREADS_DIR),
    onTick: (now, state) => {
      const { dailyTime, workdayEnd } = settings.values
      daily.maybeRun(now, state, dailyTime, workdayEnd)
    },
  })

  daily.sync(new Date())
  registerIpc()
  // Warm the account list so the settings panel opens with profile pictures already there
  void listGithubAccounts().catch(() => undefined)
  buildTray()
  registerCapture()
  openMain()
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true })
  powerMonitor.on('resume', () => void flux.refresh())
  app.on('second-instance', () => openMain())
  app.on('activate', () => openMain())
  app.on('window-all-closed', () => undefined)
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    flux.stop()
    calls.stop()
  })
  calls.start()
  await flux.start()
}

main().catch(error => {
  console.error(error)
  app.exit(1)
})
