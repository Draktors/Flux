import { contextBridge, ipcRenderer } from 'electron'
import type { CallsState } from '../shared/calls'
import type { AppState, FluxApi } from '../shared/types'

const api: FluxApi = {
  getState: () => ipcRenderer.invoke('flux:get-state'),
  onState(listener) {
    const handler = (_event: unknown, state: AppState) => listener(state)
    ipcRenderer.on('flux:state', handler)
    return () => ipcRenderer.removeListener('flux:state', handler)
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
  refresh: () => ipcRenderer.invoke('flux:refresh'),
  createNote: text => ipcRenderer.invoke('flux:create-note', text),
  openCapture: () => ipcRenderer.invoke('flux:open-capture'),
  closeCapture: () => ipcRenderer.invoke('flux:close-capture'),
  updateTopic: (id, patch) => ipcRenderer.invoke('flux:update-topic', id, patch),
  closeTopic: id => ipcRenderer.invoke('flux:close-topic', id),
  launchThread: (id, action) => ipcRenderer.invoke('flux:launch-thread', id, action),
  focusThread: (id, session) => ipcRenderer.invoke('flux:focus-thread', id, session),
  openExternal: url => ipcRenderer.invoke('flux:open-external', url),
  getSettings: () => ipcRenderer.invoke('flux:get-settings'),
  saveSettings: patch => ipcRenderer.invoke('flux:save-settings', patch),
  testNotification: () => ipcRenderer.invoke('flux:test-notification'),
  checkGithub: () => ipcRenderer.invoke('flux:check-github'),
  githubAccounts: () => ipcRenderer.invoke('flux:github-accounts'),
  checkLinearKey: key => ipcRenderer.invoke('flux:check-linear-key', key),
  checkJira: (site, email, token) => ipcRenderer.invoke('flux:check-jira', site, email, token),
  checkCalendarUrl: url => ipcRenderer.invoke('flux:check-calendar-url', url),
  runDaily: () => ipcRenderer.invoke('flux:run-daily'),
  readDaily: () => ipcRenderer.invoke('flux:read-daily'),
  openDaily: () => ipcRenderer.invoke('flux:open-daily'),
}

contextBridge.exposeInMainWorld('flux', api)
