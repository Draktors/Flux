import type {
  Ball,
  Item,
  Rank,
  Signal,
  ThreadView,
  Topic,
  TopicView,
} from '../../shared/types'
import { proposedActions } from '../threads/actions'

export interface LiveSession {
  session: string
  status: 'busy' | 'idle'
}

export interface Reconciled {
  views: TopicView[]
  loose: Item[]
  created: Topic[]
  reopened: string[]
  closed: string[]
  linked: Array<{ id: string; links: string[] }>
}

const REF_PATTERN = /^([a-z0-9_-]+#\d+|[A-Z]{2,5}-\d+)$/

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function compactDate(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

export function isLinkedRef(link: string): boolean {
  return REF_PATTERN.test(link)
}

function shares(topic: Topic, item: Item): boolean {
  return item.refs.some(ref => topic.links.includes(ref))
}

function topicFromItem(item: Item, now: Date): Topic {
  return {
    id: `${compactDate(now)}-${slug(item.ref)}`,
    title: `${item.ref} — ${item.title}`,
    status: 'open',
    links: [...item.refs],
    threads: [],
    createdAt: now.toISOString(),
    body: '',
  }
}

function compareSignals(a: Signal, b: Signal): number {
  return a.rank - b.rank || a.weight - b.weight || a.since.localeCompare(b.since)
}

function threadViews(topic: Topic, sessions: LiveSession[]): ThreadView[] {
  return topic.threads.map(thread => {
    if (thread.pending) return { ...thread, status: 'pending' }
    const live = sessions.find(session => session.session === thread.session)
    return { ...thread, status: live ? live.status : 'closed' }
  })
}

function taskSignal(topic: Topic): Signal {
  return {
    id: `task:${topic.id}`,
    rank: 6,
    weight: 0,
    detail: 'Tâche',
    since: topic.createdAt,
    stamp: topic.createdAt,
    action: 'free',
  }
}

function threadSignal(thread: ThreadView): Signal {
  return {
    id: `thread:${thread.session}`,
    rank: 5,
    weight: 0,
    detail: 'Thread revenu vers toi',
    since: thread.startedAt,
    stamp: thread.startedAt,
    action: 'resume',
  }
}

function ballOf(topic: Topic, items: Item[], signals: Signal[], threads: ThreadView[]): Ball {
  if (threads.some(thread => thread.status === 'busy')) return 'agent'
  if (topic.blocked) return 'others'
  if (signals.length > 0) return 'me'
  if (items.length > 0 && items.every(item => item.ball === 'dormant')) return 'dormant'
  return 'others'
}

function viewOf(topic: Topic, items: Item[], sessions: LiveSession[]): TopicView {
  const threads = threadViews(topic, sessions)
  const signals = items.flatMap(item => item.signals)
  if (signals.length === 0) {
    const idle = threads.find(thread => thread.status === 'idle')
    if (idle) signals.push(threadSignal(idle))
    else if (topic.status === 'open' && items.length === 0) signals.push(taskSignal(topic))
  }
  signals.sort(compareSignals)
  const lead = signals[0]
  const ball = ballOf(topic, items, signals, threads)
  const rank: Rank | null = lead ? lead.rank : null
  return {
    topic,
    items,
    signals,
    threads,
    rank,
    ball,
    since: lead ? lead.since : null,
    actions: proposedActions(topic, items, signals),
  }
}

export function reconcile(
  topics: Topic[],
  items: Item[],
  sessions: LiveSession[],
  now: Date,
): Reconciled {
  const live = topics.filter(topic => topic.status !== 'done')
  const archived = topics.filter(topic => topic.status === 'done')
  const created: Topic[] = []
  const reopened: string[] = []
  const links = new Map<string, Set<string>>()
  const pool = [...live]

  const remember = (topic: Topic, item: Item) => {
    const missing = item.refs.filter(ref => !topic.links.includes(ref))
    if (missing.length === 0) return
    topic.links = [...topic.links, ...missing]
    const set = links.get(topic.id) ?? new Set<string>()
    missing.forEach(ref => set.add(ref))
    links.set(topic.id, set)
  }

  for (const item of items) {
    const known = pool.find(topic => shares(topic, item))
    if (known) {
      remember(known, item)
      continue
    }
    if (item.ball !== 'me') continue

    const previous = archived
      .filter(topic => shares(topic, item))
      .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0]
    if (previous) {
      const latest = item.signals.reduce((max, s) => (s.stamp > max ? s.stamp : max), '')
      if (latest > (previous.closedAt ?? '')) {
        previous.status = 'open'
        previous.closedAt = undefined
        reopened.push(previous.id)
        pool.push(previous)
        remember(previous, item)
      }
      continue
    }

    const topic = topicFromItem(item, now)
    created.push(topic)
    pool.push(topic)
  }

  const closed: string[] = []
  const views: TopicView[] = []
  for (const topic of pool) {
    const attached = items.filter(item => shares(topic, item))
    const refs = topic.links.filter(isLinkedRef)
    const allTerminal =
      refs.length > 0 &&
      refs.every(ref => attached.some(item => item.ref === ref && item.terminal))
    if (allTerminal) {
      closed.push(topic.id)
      continue
    }
    views.push(viewOf(topic, attached.filter(item => !item.terminal), sessions))
  }

  const attachedRefs = new Set(pool.flatMap(topic => topic.links))
  const loose = items.filter(
    item => !item.terminal && item.signals.length === 0 && !item.refs.some(ref => attachedRefs.has(ref)),
  )

  return {
    views,
    loose,
    created,
    reopened,
    closed,
    linked: [...links.entries()].map(([id, set]) => ({ id, links: [...set] })),
  }
}

export function compareViews(a: TopicView, b: TopicView): number {
  const lead = (view: TopicView) => view.signals[0]
  const left = lead(a)
  const right = lead(b)
  if (!left || !right) return Number(Boolean(right)) - Number(Boolean(left))
  return compareSignals(left, right)
}
