import type { Meeting, TopicView } from '../../shared/types'
import { RANKS } from '../../shared/ranks'

export interface NotifyState {
  initialized: boolean
  seen: Record<string, string>
  head: string | null
  headSince: string | null
  lastNudgeAt: string | null
}

export interface NotifyContext {
  now: Date
  meeting: Meeting | null
  workdayStart: number
  workdayEnd: number
}

export interface FluxNotification {
  title: string
  body: string
  topicId: string
}

const NUDGE_MS = 2 * 3_600_000
const SEEN_RETENTION_MS = 30 * 86_400_000

export const EMPTY_NOTIFY_STATE: NotifyState = {
  initialized: false,
  seen: {},
  head: null,
  headSince: null,
  lastNudgeAt: null,
}

export function isQuiet({ now, workdayStart, workdayEnd }: NotifyContext): boolean {
  const day = now.getDay()
  const hour = now.getHours()
  return day === 0 || day === 6 || hour < workdayStart || hour >= workdayEnd
}

function describe(view: TopicView): string {
  const lead = view.signals[0]
  return lead ? `${lead.detail}` : view.topic.title
}

function prune(seen: Record<string, string>, now: Date): Record<string, string> {
  const limit = new Date(now.getTime() - SEEN_RETENTION_MS).toISOString()
  return Object.fromEntries(Object.entries(seen).filter(([, stamp]) => stamp >= limit))
}

export function decide(
  previous: NotifyState,
  queue: TopicView[],
  context: NotifyContext,
): { state: NotifyState; notifications: FluxNotification[] } {
  const { now, meeting } = context
  const nowIso = now.toISOString()
  const head = queue[0]?.topic.id ?? null
  const headChanged = head !== previous.head
  const state: NotifyState = {
    ...previous,
    head,
    headSince: headChanged ? nowIso : previous.headSince,
    lastNudgeAt: headChanged ? null : previous.lastNudgeAt,
  }

  if (isQuiet(context) || meeting) return { state, notifications: [] }

  const candidates = queue.flatMap(view =>
    view.signals.filter(signal => RANKS[signal.rank].notify).map(signal => ({ view, signal })),
  )
  const fresh = candidates.filter(({ signal }) => {
    const known = previous.seen[signal.id]
    return known === undefined || signal.stamp > known
  })
  const seen = { ...previous.seen }
  for (const { signal } of candidates) seen[signal.id] = signal.stamp
  const next: NotifyState = { ...state, initialized: true, seen: prune(seen, now) }

  if (!previous.initialized) {
    const lead = queue[0]
    if (!lead) return { state: next, notifications: [] }
    return {
      state: next,
      notifications: [
        {
          title: `${queue.length} sujets t'attendent`,
          body: `En tête : ${lead.topic.title}`,
          topicId: lead.topic.id,
        },
      ],
    }
  }

  if (fresh.length > 0) {
    const views = [...new Map(fresh.map(entry => [entry.view.topic.id, entry.view])).values()]
    const lead = views[0]
    const title =
      views.length === 1 ? lead.topic.title : `${views.length} nouveaux sujets à débloquer`
    return {
      state: next,
      notifications: [{ title, body: describe(lead), topicId: lead.topic.id }],
    }
  }

  const reference = state.lastNudgeAt ?? state.headSince
  if (head && reference && now.getTime() - new Date(reference).getTime() >= NUDGE_MS) {
    return {
      state: { ...next, lastNudgeAt: nowIso },
      notifications: [
        {
          title: `Toujours en tête : ${queue[0].topic.title}`,
          body: describe(queue[0]),
          topicId: queue[0].topic.id,
        },
      ],
    }
  }

  return { state: next, notifications: [] }
}
