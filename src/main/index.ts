import { existsSync, readFileSync } from 'node:fs'
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
import type { AppState, ProjectOptions, ProposedAction, SettingsPatch, Topic } from '../shared/types'
import type { CallPatch } from '../shared/calls'
import { Calls } from './calls/service'
import { Flux } from './engine/poller'
import { Daily, localDate } from './llm/daily'
import { createDailySkill, useDailyTemplate } from './llm/dailySkillBrief'
import { Triage } from './llm/triage'
import { notificationAccess, requestNotificationAccess } from './notificationAccess'
import { checkCalendarUrl, checkGithub, checkJira, checkLinearKey, normalizeJiraSite } from './onboarding'
import { ARCHIVE_DIR, DAILY_DIR, REPOS_DIR, THREADS_DIR, TOPICS_DIR } from './paths'
import { fetchCalendar, fetchCalendarBetween } from './sources/calendar'
import { fetchGitActivity } from './sources/commits'
import { GITHUB_HOST, listGithubAccounts, listRecentRepos } from './sources/github'
import { fetchJira, listJiraProjects } from './sources/jira'
import { fetchCompleted, fetchLinear, listLinearTeams } from './sources/linear'
import { SettingsStore } from './store/settings'
import { noteFromText, TopicStore } from './store/topics'
import { closeThreads } from './threads/close'
import { adoptThreads } from './threads/desktop'
import { goToThread, launchThread } from './threads/launch'
import { allWorkspaces } from './workspaces'

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

// A window just opened is still loading: the message waits for it
function sendToMain(channel: string, ...args: unknown[]): void {
  const window = openMain()
  const send = () => window.webContents.send(channel, ...args)
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}

function showTopic(id: string): void {
  sendToMain('flux:open-topic', id)
}

function showWrapup(): void {
  sendToMain('flux:open-wrapup-view')
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
        { label: 'Wrap-up', click: () => showWrapup() },
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

// macOS drops notifications silently when the person refused them for this bundle id
function bundleId(): string | null {
  if (!app.isPackaged) return null
  const plist = readFileSync(join(process.resourcesPath, '..', 'Info.plist'), 'utf8')
  return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? null
}

function openNotificationSettings(): Promise<void> {
  const id = bundleId()
  const pane = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
  return shell.openExternal(id ? `${pane}?id=${encodeURIComponent(id)}` : pane)
}

function notify(title: string, body: string, onClick: () => void): void {
  console.log(`${new Date().toISOString()} notification : ${title} | ${body}`)
  const notification = new Notification({ title, body, silent: false })
  liveNotifications.add(notification)
  notification.on('failed', (_event, error) => {
    liveNotifications.delete(notification)
    console.error(`Notification refusée par macOS : ${error}`)
  })
  notification.on('click', () => {
    liveNotifications.delete(notification)
    onClick()
  })
  notification.on('close', () => liveNotifications.delete(notification))
  notification.show()
}

function notifyDaily(): void {
  notify('Daily prêt', 'Le récap du jour t’attend dans Flux.', () => sendToMain('flux:open-daily-view'))
}

function requireTopic(id: string): Topic {
  const topic = flux.topic(id)
  if (!topic) throw new Error(`Sujet introuvable : ${id}`)
  return topic
}

// What the projects picker offers: every Jira project and Linear team you can see, and your repos
async function listProjects(): Promise<ProjectOptions> {
  const errors: string[] = []
  const settled = async <T>(label: string, task: Promise<T>, fallback: T): Promise<T> =>
    task.catch(error => {
      errors.push(`${label} : ${(error as Error).message}`)
      return fallback
    })
  const token = settings.secret('jiraToken')
  const email = settings.values.jiraEmail
  const site = settings.jiraSite()
  const linearKey = settings.secret('linearKey')
  const [jira, linear, recent] = await Promise.all([
    settings.uses('jira') && token && email && site
      ? settled('Jira', listJiraProjects({ site, email, token }), [])
      : [],
    settings.uses('linear') && linearKey ? settled('Linear', listLinearTeams(linearKey), []) : [],
    settled('GitHub', listRecentRepos(settings.values.githubAccount), []),
  ])
  // Repos already attached stay listed even without a recent PR
  const attached = (settings.values.projects ?? []).flatMap(project => project.repos)
  return {
    projects: [
      ...jira.map(project => ({ tracker: 'jira' as const, ...project })),
      ...linear.map(team => ({ tracker: 'linear' as const, ...team })),
    ],
    repos: [...new Set([...recent, ...attached])],
    errors,
  }
}

// Loads today's run of every workspace, so switching shows each one's daily at once
function syncDailies(): void {
  const now = new Date()
  const workspaces = allWorkspaces()
  if (workspaces.length === 0) daily.sync(now, null)
  for (const workspace of workspaces) daily.sync(now, workspace.id)
}

function registerIpc(): void {
  ipcMain.handle('flux:get-state', () => flux.current())
  ipcMain.handle('flux:refresh', async () => {
    await Promise.all([flux.refresh(), calls.sync()])
  })
  ipcMain.handle('flux:refresh-all', async () => {
    await Promise.all([flux.refreshAll(), calls.sync()])
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
  ipcMain.handle('flux:check-wrapup', (_event, id: string, done: boolean) =>
    flux.checkWrapup(id, done),
  )
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
    // Switching or editing workspaces only redraws from the cache; a new workspace is fetched
    // by the next tick, which reads any workspace it has no data for yet
    if (Object.keys(patch).every(key => key === 'workspace' || key === 'projects')) {
      if (patch.projects !== undefined) flux.forgetOtherWorkspaces()
      // The Daily tab follows the workspace: each one keeps its own run
      syncDailies()
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
  ipcMain.handle('flux:open-notification-settings', () => openNotificationSettings())
  ipcMain.handle('flux:notification-access', () => notificationAccess())
  ipcMain.handle('flux:request-notification-access', () => requestNotificationAccess())
  ipcMain.handle('flux:check-github', () => checkGithub(settings.values.githubAccount))
  ipcMain.handle('flux:github-accounts', async () => ({
    host: GITHUB_HOST,
    ...(await listGithubAccounts()),
  }))
  ipcMain.handle('flux:check-linear-key', (_event, key: string) => checkLinearKey(key))
  ipcMain.handle('flux:check-jira', (_event, site: string, email: string, token: string) =>
    checkJira(site, email, token),
  )
  ipcMain.handle('flux:list-projects', () => listProjects())
  ipcMain.handle('flux:check-calendar-url', (_event, url: string) => checkCalendarUrl(url))
  ipcMain.handle('flux:get-calls', () => calls.state())
  ipcMain.handle('flux:update-call', (_event, id: string, patch: CallPatch) => calls.update(id, patch))
  ipcMain.handle('flux:sync-calls', () => calls.sync())
  ipcMain.handle('flux:connect-granola', () => calls.connect(url => void shell.openExternal(url)))
  ipcMain.handle('flux:disconnect-granola', () => calls.disconnect())
  ipcMain.handle('flux:run-daily', () => daily.run(new Date(), flux.current()))
  ipcMain.handle('flux:open-daily', () => {
    const path = join(DAILY_DIR, `${localDate(new Date())}.md`)
    if (!existsSync(path)) return undefined
    return shell.openExternal(`obsidian://open?path=${encodeURIComponent(path)}`)
  })
  ipcMain.handle('flux:set-intentions', (_event, ids: string[]) => flux.setIntentions(ids))
  ipcMain.handle('flux:use-daily-template', async () => {
    const result = await useDailyTemplate()
    if (result.ok) await flux.refresh()
    return result
  })
  ipcMain.handle('flux:create-daily-skill', () => createDailySkill())
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  await app.whenReady()
  settings = new SettingsStore()
  const triage = new Triage()
  daily = new Daily(
    state => flux.setDaily(state),
    () => notifyDaily(),
  )
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
    onProgress(progress) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('flux:progress', progress)
      }
    },
    onNotify: ({ title, body, topicId }) => notify(title, body, () => showTopic(topicId)),
    onWrapup: ({ title, body }) => notify(title, body, () => showWrapup()),
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
    fetchCompleted: async since => {
      const key = settings.secret('linearKey')
      return key ? fetchCompleted(key, since) : []
    },
    fetchMeetings: async () => {
      const url = settings.secret('calendarUrl')
      return url && settings.calendar() ? fetchCalendar(url) : null
    },
    fetchMeetingsBetween: async (from, to) => {
      const url = settings.secret('calendarUrl')
      return url && settings.calendar() ? fetchCalendarBetween(url, from, to) : null
    },
    fetchGitActivity: since => fetchGitActivity(REPOS_DIR, since),
    closeThreads: topic => closeThreads(topic, flux.liveSessions()),
    adoptThreads: topics => adoptThreads(topics, THREADS_DIR),
    onTick: (now, state) => {
      const { dailyTime, workdayEnd } = settings.values
      daily.maybeRun(now, state, dailyTime, workdayEnd)
    },
  })

  syncDailies()
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
