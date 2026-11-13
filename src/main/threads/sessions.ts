import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { ThreadRef, Topic } from '../../shared/types'
import { DESKTOP_SESSIONS_DIR } from '../paths'

// What Claude Desktop keeps of one Code session, read from its own record
export interface DesktopSession {
  // Desktop's id (local_…): stable for the life of the session, and what reopens it
  id: string
  // The conversation id; Desktop may move the session to a new one and keeps the former ones
  cli: string
  previous: string[]
  title: string
  archived: boolean
  // Last turn, in ms since the epoch
  activeAt: number | null
}

export function parseDesktopSession(raw: unknown): DesktopSession | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.sessionId !== 'string' || !record.sessionId.startsWith('local_')) return null
  if (typeof record.cliSessionId !== 'string') return null
  const previous = Array.isArray(record.previousCliSessionIds) ? record.previousCliSessionIds : []
  return {
    id: record.sessionId,
    cli: record.cliSessionId,
    previous: previous.filter((entry): entry is string => typeof entry === 'string'),
    title: typeof record.title === 'string' ? record.title : '',
    archived: record.isArchived === true,
    activeAt: typeof record.lastActivityAt === 'number' ? record.lastActivityAt : null,
  }
}

// Records weigh hundreds of KB: only those changed since the last read are parsed again
const cache = new Map<string, { mtimeMs: number; session: DesktopSession | null }>()

async function entries(path: string): Promise<string[]> {
  return readdir(path).catch(() => [])
}

// Records sit two folders deep, one per account and one per organisation
export async function readDesktopSessions(root = DESKTOP_SESSIONS_DIR): Promise<DesktopSession[]> {
  const files: string[] = []
  for (const account of await entries(root)) {
    for (const org of await entries(join(root, account))) {
      for (const file of await entries(join(root, account, org))) {
        if (file.startsWith('local_') && file.endsWith('.json')) files.push(join(root, account, org, file))
      }
    }
  }
  const sessions: DesktopSession[] = []
  for (const path of files) {
    const info = await stat(path).catch(() => null)
    if (!info) continue
    let entry = cache.get(path)
    if (!entry || entry.mtimeMs !== info.mtimeMs) {
      const raw = await readFile(path, 'utf8')
        .then(text => JSON.parse(text) as unknown)
        .catch(() => null)
      entry = { mtimeMs: info.mtimeMs, session: parseDesktopSession(raw) }
      cache.set(path, entry)
    }
    if (entry.session) sessions.push(entry.session)
  }
  const seen = new Set(files)
  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path)
  return sessions
}

// A thread's session: by Desktop id or conversation id, current or former. A session archived and
// then imported again exists twice: the one still open wins, then the latest
export function desktopOf(thread: ThreadRef, sessions: DesktopSession[]): DesktopSession | undefined {
  const matches = sessions.filter(
    session =>
      session.id === thread.desktop ||
      session.cli === thread.session ||
      session.previous.includes(thread.session),
  )
  return matches.sort(
    (a, b) => Number(a.archived) - Number(b.archived) || (b.activeAt ?? 0) - (a.activeAt ?? 0),
  )[0]
}

// Keeps each thread on its Desktop session: its id, a conversation id that moved, and its title
export function syncThreads(topics: Topic[], sessions: DesktopSession[]): Topic[] {
  const changed = new Set<Topic>()
  for (const topic of topics) {
    for (const thread of topic.threads) {
      if (thread.pending) continue
      const session = desktopOf(thread, sessions)
      if (!session) continue
      const before = [thread.desktop, thread.session, thread.title].join('|')
      thread.desktop = session.id
      thread.session = session.cli
      if (session.title) thread.title = session.title
      if ([thread.desktop, thread.session, thread.title].join('|') !== before) changed.add(topic)
    }
  }
  return [...changed]
}
