import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { Settings, SettingsPatch } from '../../shared/types'
import { SECRETS_FILE, SETTINGS_FILE } from '../paths'

type Secret = 'linearKey' | 'calendarUrl'

interface Stored {
  dailyTime: string
  captureShortcut: string
  workdayStart: number
  workdayEnd: number
  onboarded: boolean
}

const DEFAULTS: Stored = {
  dailyTime: '08:45',
  captureShortcut: 'Control+Alt+N',
  workdayStart: 9,
  workdayEnd: 19,
  onboarded: false,
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, value: unknown, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), { mode })
}

export class SettingsStore {
  private stored: Stored = { ...DEFAULTS, ...readJson<Partial<Stored>>(SETTINGS_FILE, {}) }
  private secrets = readJson<Partial<Record<Secret, string>>>(SECRETS_FILE, {})

  get values(): Stored {
    return this.stored
  }

  secret(name: Secret): string | null {
    const encoded = this.secrets[name]
    if (!encoded) return null
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  }

  public(): Settings {
    return {
      ...this.stored,
      hasLinearKey: Boolean(this.secrets.linearKey),
      hasCalendarUrl: Boolean(this.secrets.calendarUrl),
    }
  }

  apply(patch: SettingsPatch): void {
    const { linearKey, calendarUrl, ...plain } = patch
    this.stored = { ...this.stored, ...plain }
    writeJson(SETTINGS_FILE, this.stored)
    const secrets: Array<[Secret, string | undefined]> = [
      ['linearKey', linearKey],
      ['calendarUrl', calendarUrl],
    ]
    for (const [name, value] of secrets) {
      if (value === undefined) continue
      if (value === '') delete this.secrets[name]
      else this.secrets[name] = safeStorage.encryptString(value).toString('base64')
    }
    writeJson(SECRETS_FILE, this.secrets, 0o600)
  }
}
