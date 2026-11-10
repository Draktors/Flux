import { existsSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import type {
  CallPatch,
  CallsState,
  CallSource,
  CallType,
  CallView,
  GranolaStatus,
} from '../../shared/calls'
import { CONFIG } from '../config'
import { classifyWithClaude } from '../llm/calls'
import { CALLS_FILE } from '../paths'
import { Granola, type GranolaAuth, type GranolaNote } from '../sources/granola'
import type { SettingsStore } from '../store/settings'
import { classifyByRules, rotationWorkspace, settled } from './classify'

const SYNC_MS = 10 * 60_000

interface Stored {
  type: CallType
  workspace: string | null
  typeSource: CallSource
  workspaceSource: CallSource
  uncertain: boolean
}

interface CallsFile {
  notes: Record<string, GranolaNote>
  classes: Record<string, Stored>
  // Your corrections, kept apart so a new summary never overwrites them
  overrides: Record<string, CallPatch>
}

const EMPTY: CallsFile = { notes: {}, classes: {}, overrides: {} }

function load(): CallsFile {
  if (!existsSync(CALLS_FILE)) return structuredClone(EMPTY)
  try {
    return { ...structuredClone(EMPTY), ...(JSON.parse(readFileSync(CALLS_FILE, 'utf8')) as Partial<CallsFile>) }
  } catch {
    return structuredClone(EMPTY)
  }
}

export function viewOf(note: GranolaNote, stored: Stored, override: CallPatch | undefined): CallView {
  const type = override?.type ?? stored.type
  const workspace = override?.workspace ?? stored.workspace
  const typeSource: CallSource = override?.type ? 'you' : stored.typeSource
  const workspaceSource: CallSource = override?.workspace ? 'you' : stored.workspaceSource
  // A field you set is never in doubt; the other one keeps Flux's doubt
  const doubtfulType = !override?.type && (stored.typeSource === 'rotation' || (stored.uncertain && stored.typeSource === 'claude'))
  const doubtfulWorkspace =
    CONFIG.workspaces.length > 1 &&
    !override?.workspace &&
    (stored.workspaceSource === 'rotation' || (stored.uncertain && stored.workspaceSource === 'claude'))
  return {
    id: note.id,
    title: note.title,
    at: note.at,
    url: note.url,
    participants: note.participants,
    summary: note.summary,
    type,
    workspace,
    typeSource,
    workspaceSource,
    uncertain: doubtfulType || doubtfulWorkspace,
  }
}

export class Calls {
  private file = load()
  private readonly granola: Granola
  private status: GranolaStatus = { connected: false, email: null, connecting: false, error: null, at: null }
  private timer: NodeJS.Timeout | null = null
  private syncing: Promise<void> | null = null

  constructor(
    settings: SettingsStore,
    private readonly onChange: (state: CallsState) => void,
  ) {
    this.granola = new Granola({
      read: () => {
        const raw = settings.secret('granola')
        return raw ? (JSON.parse(raw) as GranolaAuth) : {}
      },
      write: auth => settings.setSecret('granola', Object.keys(auth).length > 0 ? JSON.stringify(auth) : null),
    })
    this.status.connected = this.granola.hasSession
  }

  start(): void {
    void this.sync()
    this.timer = setInterval(() => void this.sync(), SYNC_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    void this.granola.close()
  }

  state(): CallsState {
    const calls = Object.values(this.file.notes)
      .flatMap(note => {
        const stored = this.file.classes[note.id]
        return stored ? [viewOf(note, stored, this.file.overrides[note.id])] : []
      })
      .sort((a, b) => b.at.localeCompare(a.at))
    return { calls, granola: this.status }
  }

  private emit(): void {
    this.onChange(this.state())
  }

  private setStatus(patch: Partial<GranolaStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit()
  }

  async connect(openBrowser: (url: string) => void): Promise<void> {
    this.setStatus({ connecting: true, error: null })
    try {
      await this.granola.signIn(openBrowser)
      this.setStatus({ connected: true, connecting: false, email: await this.granola.email().catch(() => null) })
      await this.sync()
    } catch (error) {
      this.setStatus({ connecting: false, error: (error as Error).message })
      throw error
    }
  }

  async disconnect(): Promise<void> {
    await this.granola.signOut()
    this.setStatus({ connected: false, email: null, error: null })
  }

  async update(id: string, patch: CallPatch): Promise<void> {
    this.file.overrides[id] = { ...this.file.overrides[id], ...patch }
    await this.save()
    this.emit()
  }

  sync(): Promise<void> {
    this.syncing ??= this.run().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async run(): Promise<void> {
    if (!this.granola.hasSession) {
      if (this.status.connected) this.setStatus({ connected: false })
      return
    }
    try {
      if (!this.status.email) this.status.email = await this.granola.email().catch(() => null)
      const meetings = await this.granola.meetings()
      const stale = meetings.filter(meeting => {
        const known = this.file.notes[meeting.id]
        return !known || (meeting.updatedAt !== null && meeting.updatedAt !== known.updatedAt)
      })
      for (const note of await this.granola.notes(stale.map(meeting => meeting.id))) {
        // list_meetings carries updated_at only on filtered queries: keep the one we compared against
        const listed = meetings.find(meeting => meeting.id === note.id)
        this.file.notes[note.id] = { ...note, updatedAt: note.updatedAt ?? listed?.updatedAt ?? null }
        delete this.file.classes[note.id]
      }
      await this.classify()
      await this.save()
      this.status = { ...this.status, connected: true, error: null, at: new Date().toISOString() }
    } catch (error) {
      const message = (error as Error).message
      const signedOut = /unauthori|reconnecter|401/i.test(message)
      this.status = { ...this.status, connected: !signedOut && this.granola.hasSession, error: message }
    }
    this.emit()
  }

  private async classify(): Promise<void> {
    const pending = Object.values(this.file.notes).filter(note => !this.file.classes[note.id])
    const unsure: GranolaNote[] = []
    for (const note of pending) {
      const rules = classifyByRules(note, CONFIG)
      this.file.classes[note.id] = {
        type: rules.type.value,
        workspace: rules.workspace.value,
        typeSource: rules.type.source,
        workspaceSource: rules.workspace.source,
        uncertain: !settled(rules, CONFIG.workspaces),
      }
      if (!settled(rules, CONFIG.workspaces)) unsure.push(note)
    }
    if (unsure.length === 0) return
    try {
      const verdicts = await classifyWithClaude(
        unsure.map(note => ({
          id: note.id,
          title: note.title,
          at: note.at,
          summary: note.summary,
          expected: rotationWorkspace(CONFIG.rotation, new Date(note.at)),
        })),
      )
      for (const note of unsure) {
        const verdict = verdicts[note.id]
        const stored = this.file.classes[note.id]
        if (!verdict) continue
        // Claude only fills what the rules could not tell
        if (stored.typeSource === 'rotation') {
          stored.type = verdict.type
          stored.typeSource = 'claude'
        }
        if (stored.workspaceSource === 'rotation' && verdict.workspace) {
          stored.workspace = verdict.workspace
          stored.workspaceSource = 'claude'
        }
        stored.uncertain = !verdict.confident
      }
    } catch (error) {
      console.error('Classement des calls par Claude indisponible', error)
    }
  }

  private async save(): Promise<void> {
    const draft = `${CALLS_FILE}.tmp`
    await writeFile(draft, JSON.stringify(this.file))
    await rename(draft, CALLS_FILE)
  }
}
