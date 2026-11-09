import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { Topic } from '../../shared/types'

import { run } from '../exec'
import { BIN, CLAUDE_PROJECTS_DIR } from '../paths'

const HEAD_BYTES = 256 * 1024
const ADOPT_WINDOW_MS = 24 * 60 * 60 * 1000
const CLOCK_SKEW_MS = 60 * 1000

// Claude Desktop opens a new Code session on these folders and sends the prompt right away.
export function newSessionUrl(prompt: string, folders: string[]): string {
  const params = new URLSearchParams({ q: prompt })
  for (const folder of folders) params.append('folder', folder)
  return `claude://code/new?${params}`
}

export function resumeUrl(session: string): string {
  return `claude://resume?${new URLSearchParams({ session })}`
}

export async function openInDesktop(url: string): Promise<void> {
  await run(BIN.open, [url])
}

// A thread folder holds the brief, so its path is in the first message of the session it started.
export function briefMarker(dir: string): string {
  return `${dir}/brief.md`
}

async function readHead(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function modifiedSince(path: string, since: number): Promise<boolean> {
  const info = await stat(path).catch(() => null)
  return info !== null && info.mtimeMs >= since
}

// Desktop picks the session id itself: find the transcript whose first lines carry the marker.
export async function findSession(
  marker: string,
  since: number,
  root = CLAUDE_PROJECTS_DIR,
): Promise<string | undefined> {
  const projects = await readdir(root).catch(() => [])
  for (const project of projects) {
    const directory = join(root, project)
    if (!(await modifiedSince(directory, since))) continue
    const files = await readdir(directory).catch(() => [])
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const path = join(directory, file)
      if (!(await modifiedSince(path, since))) continue
      const head = await readHead(path).catch(() => '')
      if (head.includes(marker)) return file.slice(0, -'.jsonl'.length)
    }
  }
  return undefined
}

export async function adoptThreads(
  topics: Topic[],
  threadsDir: string,
  now = Date.now(),
  root = CLAUDE_PROJECTS_DIR,
): Promise<Topic[]> {
  const changed = new Set<Topic>()
  for (const topic of topics) {
    for (const thread of topic.threads) {
      if (!thread.pending) continue
      const startedAt = Date.parse(thread.startedAt)
      if (now - startedAt > ADOPT_WINDOW_MS) continue
      const dir = join(threadsDir, thread.dir ?? thread.session)
      const session = await findSession(briefMarker(dir), startedAt - CLOCK_SKEW_MS, root)
      if (!session) continue
      thread.session = session
      thread.pending = undefined
      changed.add(topic)
    }
  }
  return [...changed]
}
