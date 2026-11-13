import { contextBridge, ipcRenderer } from 'electron'
import type { CallsState } from '../shared/calls'
import type { AppState, FluxApi, SourceProgress } from '../shared/types'

const api: FluxApi = {
  getState: () => ipcRenderer.invoke('flux:get-state'),
  refreshAll: () => ipcRenderer.invoke('flux:refresh-all'),
  onState(listener) {
    const handler = (_event: unknown, state: AppState) => listener(state)
    ipcRenderer.on('flux:state', handler)
    return () => ipcRenderer.removeListener('flux:state', handler)
  },
  onProgress(listener) {
    const handler = (_event: unknown, progress: SourceProgress) => listener(progress)
    ipcRenderer.on('flux:progress', handler)
    return () => ipcRenderer.removeListener('flux:progress', handler)
  },
  onOpenTopic(listener) {
    const handler = (_event: unknown, id: string) => listener(id)
    ipcRenderer.on('flux:open-topic', handler)
    return () => ipcRenderer.removeListener('flux:open-topic', handler)
  },
  onOpenDaily(listener) {
    const handler = () => listener()
    ipcRenderer.on('flux:open-daily-view', handler)
    return () => ipcRenderer.removeListener('flux:open-daily-view', handler)
  },
  onRefreshShortcut(listener) {
    const handler = () => listener()
    ipcRenderer.on('flux:refresh-shortcut', handler)
    return () => ipcRenderer.removeListener('flux:refresh-shortcut', handler)
  },
  getCalls: () => ipcRenderer.invoke('flux:get-calls'),
  onCalls(listener) {
    const handler = (_event: unknown, state: CallsState) => listener(state)
    ipcRenderer.on('flux:calls', handler)
    return () => ipcRenderer.removeListener('flux:calls', handler)
  },
  updateCall: (id, patch) => ipcRenderer.invoke('flux:update-call', id, patch),
  syncCalls: () => ipcRenderer.invoke('flux:sync-calls'),
  connectGranola: () => ipcRenderer.invoke('flux:connect-granola'),
  disconnectGranola: () => ipcRenderer.invoke('flux:disconnect-granola'),
  onOpenWrapup(listener) {
    const handler = () => listener()
    ipcRenderer.on('flux:open-wrapup-view', handler)
    return () => ipcRenderer.removeListener('flux:open-wrapup-view', handler)
  },
  takeLink: () => ipcRenderer.invoke('flux:take-link'),
  onOpenLink(listener) {
    const handler = (_event: unknown, link: string) => listener(link)
    ipcRenderer.on('flux:open-link', handler)
    return () => ipcRenderer.removeListener('flux:open-link', handler)
  },
  showLinkMenu: menu => ipcRenderer.invoke('flux:link-menu', menu),
  checkWrapup: (id, done) => ipcRenderer.invoke('flux:check-wrapup', id, done),
  refresh: () => ipcRenderer.invoke('flux:refresh'),
  createNote: text => ipcRenderer.invoke('flux:create-note', text),
  openCapture: () => ipcRenderer.invoke('flux:open-capture'),
  closeCapture: () => ipcRenderer.invoke('flux:close-capture'),
  recordCaptureShortcut: recording => ipcRenderer.invoke('flux:record-capture-shortcut', recording),
  checkShortcut: accelerator => ipcRenderer.invoke('flux:check-shortcut', accelerator),
  updateTopic: (id, patch) => ipcRenderer.invoke('flux:update-topic', id, patch),
  closeTopic: id => ipcRenderer.invoke('flux:close-topic', id),
  launchThread: (id, action) => ipcRenderer.invoke('flux:launch-thread', id, action),
  focusThread: (id, session) => ipcRenderer.invoke('flux:focus-thread', id, session),
  openExternal: url => ipcRenderer.invoke('flux:open-external', url),
  getSettings: () => ipcRenderer.invoke('flux:get-settings'),
  saveSettings: patch => ipcRenderer.invoke('flux:save-settings', patch),
  profiles: () => ipcRenderer.invoke('flux:profiles'),
  setProfiles: patch => ipcRenderer.invoke('flux:set-profiles', patch),
  testNotification: () => ipcRenderer.invoke('flux:test-notification'),
  openNotificationSettings: () => ipcRenderer.invoke('flux:open-notification-settings'),
  notificationAccess: () => ipcRenderer.invoke('flux:notification-access'),
  requestNotificationAccess: () => ipcRenderer.invoke('flux:request-notification-access'),
  checkGithub: () => ipcRenderer.invoke('flux:check-github'),
  githubAccounts: () => ipcRenderer.invoke('flux:github-accounts'),
  checkLinearKey: key => ipcRenderer.invoke('flux:check-linear-key', key),
  checkJira: (site, email, token) => ipcRenderer.invoke('flux:check-jira', site, email, token),
  listProjects: () => ipcRenderer.invoke('flux:list-projects'),
  checkCalendarUrl: url => ipcRenderer.invoke('flux:check-calendar-url', url),
  runDaily: () => ipcRenderer.invoke('flux:run-daily'),
  openDaily: () => ipcRenderer.invoke('flux:open-daily'),
  hasObsidian: () => ipcRenderer.invoke('flux:has-obsidian'),
  setIntentions: ids => ipcRenderer.invoke('flux:set-intentions', ids),
  useDailyTemplate: () => ipcRenderer.invoke('flux:use-daily-template'),
  createDailySkill: () => ipcRenderer.invoke('flux:create-daily-skill'),
}

contextBridge.exposeInMainWorld('flux', api)
