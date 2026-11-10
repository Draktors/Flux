import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { Settings, SettingsPatch } from '../../shared/types'
import type { CalendarName } from '../../shared/calendars'
import { AVAILABLE_TRACKERS, type TrackerName } from '../../shared/trackers'
import { CONFIG } from '../config'
import { SECRETS_FILE, SETTINGS_FILE } from '../paths'
import { resolveWorkspace } from '../workspaces'

type Secret = 'linearKey' | 'calendarUrl' | 'jiraToken' | 'granola'

interface Stored {
  dailyTime: string
  captureShortcut: string
  workdayStart: number
  workdayEnd: number
  onboarded: boolean
  githubAccount: string | null
  // Workspace id Flux shows; null picks the first configured one
  workspace: string | null
  jiraEmail: string
  jiraSite: string
  // null until chosen: derived from the keys already saved
  trackers: TrackerName[] | null
  // null until chosen: Google when an iCal link is already saved, as before
  calendar: CalendarName | 'none' | null
}

const DEFAULTS: Stored = {
  dailyTime: '08:45',
  captureShortcut: 'Control+Alt+N',
  workdayStart: 9,
  workdayEnd: 19,
  onboarded: false,
  githubAccount: null,
  workspace: null,
  jiraEmail: '',
  jiraSite: '',
  trackers: null,
  calendar: null,
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

  // The site typed in the settings wins over the one in config.json
  jiraSite(): string {
    return (this.stored.jiraSite || CONFIG.jira.site).replace(/\/+$/, '')
  }

  trackers(): TrackerName[] {
    const chosen = this.stored.trackers
    if (chosen) return chosen.filter(name => AVAILABLE_TRACKERS.includes(name))
    const derived: TrackerName[] = []
    if (this.secrets.jiraToken || CONFIG.jira.site) derived.push('jira')
    if (this.secrets.linearKey) derived.push('linear')
    return derived
  }

  calendar(): CalendarName | null {
    const chosen = this.stored.calendar
    if (chosen === 'none') return null
    return chosen ?? (this.secrets.calendarUrl ? 'google' : null)
  }

  uses(tracker: TrackerName): boolean {
    return this.trackers().includes(tracker)
  }

  public(): Settings {
    return {
      ...this.stored,
      hasLinearKey: Boolean(this.secrets.linearKey),
      hasCalendarUrl: Boolean(this.secrets.calendarUrl),
      hasJiraToken: Boolean(this.secrets.jiraToken),
      jiraSite: this.jiraSite(),
      trackers: this.trackers(),
      calendar: this.calendar(),
      workspace: resolveWorkspace(CONFIG.workspaces, this.stored.workspace)?.id ?? null,
    }
  }

  // Secrets Flux writes itself, outside the settings panel (Granola's session)
  setSecret(name: Secret, value: string | null): void {
    if (value === null) delete this.secrets[name]
    else this.secrets[name] = safeStorage.encryptString(value).toString('base64')
    writeJson(SECRETS_FILE, this.secrets, 0o600)
  }

  apply(patch: SettingsPatch): void {
    const { linearKey, calendarUrl, jiraToken, ...plain } = patch
    this.stored = { ...this.stored, ...plain }
    writeJson(SETTINGS_FILE, this.stored)
    const secrets: Array<[Secret, string | undefined]> = [
      ['linearKey', linearKey],
      ['calendarUrl', calendarUrl],
      ['jiraToken', jiraToken],
    ]
    for (const [name, value] of secrets) {
      if (value === undefined) continue
      if (value === '') delete this.secrets[name]
      else this.secrets[name] = safeStorage.encryptString(value).toString('base64')
    }
    writeJson(SECRETS_FILE, this.secrets, 0o600)
  }
}
