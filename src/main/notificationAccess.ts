import { app } from 'electron'
import { join } from 'node:path'

import type { NotificationAccess } from '../shared/types'

interface Native {
  status(): Promise<{ status: NotificationAccess; error?: string }>
  request(): Promise<{ status: NotificationAccess; error?: string }>
}

let native: Native | null | undefined

// The addon is built by `pnpm build:native` and shipped next to the app's resources
function load(): Native | null {
  if (native !== undefined) return native
  native = null
  if (process.platform !== 'darwin') return native
  const path = app.isPackaged
    ? join(process.resourcesPath, 'notifications.node')
    : join(app.getAppPath(), 'native/build/notifications.node')
  try {
    const module = { exports: {} as Native }
    process.dlopen(module, path)
    native = module.exports
  } catch (error) {
    console.error(`Module de notifications introuvable (${path}) : ${(error as Error).message}`)
  }
  return native
}

async function call(kind: keyof Native): Promise<NotificationAccess> {
  const addon = load()
  if (!addon) return 'unsupported'
  const result = await addon[kind]()
  if (result.error) console.error(`Autorisation des notifications : ${result.error}`)
  return result.status
}

export const notificationAccess = (): Promise<NotificationAccess> => call('status')

// Shows the macOS prompt the first time; once answered, macOS only reports the answer
export const requestNotificationAccess = (): Promise<NotificationAccess> => call('request')
