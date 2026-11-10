import { contextBridge, ipcRenderer } from 'electron'
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
  openNotificationSettings: () => ipcRenderer.invoke('flux:open-notification-settings'),
  checkGithub: () => ipcRenderer.invoke('flux:check-github'),
  checkLinearKey: key => ipcRenderer.invoke('flux:check-linear-key', key),
  checkCalendarUrl: url => ipcRenderer.invoke('flux:check-calendar-url', url),
  runDaily: () => ipcRenderer.invoke('flux:run-daily'),
  readDaily: () => ipcRenderer.invoke('flux:read-daily'),
  openDaily: () => ipcRenderer.invoke('flux:open-daily'),
}

contextBridge.exposeInMainWorld('flux', api)
