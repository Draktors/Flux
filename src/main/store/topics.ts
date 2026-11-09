import { existsSync, watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { ThreadRef, Topic, TopicStatus } from '../../shared/types'

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/
const STATUSES: TopicStatus[] = ['inbox', 'open', 'done']

export function parseTopic(content: string, fallbackId: string): Topic | null {
  const match = FRONT_MATTER.exec(content)
  if (!match) return null
  const data = parse(match[1]) as Record<string, unknown> | null
  if (!data || typeof data !== 'object') return null
  const status = STATUSES.includes(data.status as TopicStatus)
    ? (data.status as TopicStatus)
    : 'inbox'
  return {
    id: typeof data.id === 'string' ? data.id : fallbackId,
    title: typeof data.title === 'string' ? data.title : fallbackId,
    status,
    links: Array.isArray(data.links) ? data.links.map(String) : [],
    threads: Array.isArray(data.threads) ? (data.threads as ThreadRef[]) : [],
    blocked: typeof data.blocked === 'string' ? data.blocked : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date(0).toISOString(),
    closedAt: typeof data.closedAt === 'string' ? data.closedAt : undefined,
    body: match[2].replace(/^\n/, ''),
  }
}

export function serializeTopic(topic: Topic): string {
  const { body, ...front } = topic
  const data = Object.fromEntries(
    Object.entries(front).filter(([, value]) => value !== undefined),
  )
  return `---\n${stringify(data).trimEnd()}\n---\n\n${body}`
}

export function noteFromText(text: string, now: Date): Topic {
  const [first, ...rest] = text.trim().split('\n')
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const slug = first
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40)
  return {
    id: `${stamp}-${slug || 'note'}`,
    title: first.trim(),
    status: 'inbox',
    links: [],
    threads: [],
    createdAt: now.toISOString(),
    body: rest.join('\n').trim(),
  }
}

async function readTopics(directory: string): Promise<Topic[]> {
  if (!existsSync(directory)) return []
  const names = await readdir(directory)
  const topics = await Promise.all(
    names
      .filter(name => name.endsWith('.md'))
      .map(async name => {
        const content = await readFile(join(directory, name), 'utf8')
        return parseTopic(content, name.replace(/\.md$/, ''))
      }),
  )
  return topics.filter((topic): topic is Topic => topic !== null)
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`
  await writeFile(temporary, content)
  await rename(temporary, path)
}

export class TopicStore {
  private watcher: FSWatcher | null = null

  constructor(
    private readonly directory: string,
    private readonly archive: string,
  ) {}

  async load(): Promise<Topic[]> {
    await mkdir(this.archive, { recursive: true })
    const [live, done] = await Promise.all([readTopics(this.directory), readTopics(this.archive)])
    return [...live, ...done]
  }

  private fileFor(topic: Topic): string {
    return join(topic.status === 'done' ? this.archive : this.directory, `${topic.id}.md`)
  }

  async save(topic: Topic): Promise<void> {
    await mkdir(this.archive, { recursive: true })
    await writeAtomic(this.fileFor(topic), serializeTopic(topic))
    const other = join(topic.status === 'done' ? this.directory : this.archive, `${topic.id}.md`)
    await rm(other, { force: true })
  }

  watch(listener: () => void): void {
    let timer: NodeJS.Timeout | null = null
    this.watcher = watch(this.directory, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(listener, 400)
    })
  }

  stop(): void {
    this.watcher?.close()
  }
}
