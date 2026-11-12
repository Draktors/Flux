import type {
  Meeting,
  MergedPr,
  Rank,
  SourceName,
  Topic,
  TopicView,
  WrapupDone,
  WrapupFocus,
  WrapupOutcome,
  WrapupView,
} from '../../shared/types'
import { isLinkedRef } from './ball'

export const DEFAULT_WRAPUP_TIMES = ['11:00', '14:30', '16:30']

const FOCUS_SIZE = 3
// A slot the Mac slept through is dropped past this delay rather than notified late
const GRACE_MINUTES = 90
// Only real asks count as work done when they leave: idle threads and free tasks come and go
const LAST_ASK_RANK: Rank = 4
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export interface Ask {
  topicId: string
  detail: string
  rank: Rank
  stamp: string
}

export interface HandledAsk extends Ask {
  at: string
}

// What the wrap-up remembers of one day, kept apart from the topics themselves
export interface WrapupJournal {
  date: string
  // Asks present at the last look, by signal id
  open: Record<string, Ask>
  // Asks that left the flux today
  handled: Record<string, HandledAsk>
  // Topics ticked by hand in the wrap-up, with the time
  ticked: Record<string, string>
  // Reminder slots already notified or dropped today
  fired: string[]
  // Today's intentions in order, proposed by the daily or set by hand
  intentions: string[]
  intentionsEdited: boolean
  // The daily run the intentions came from, so each run is applied once
  intentionsFrom: string | null
}

export interface WrapupNotification {
  title: string
  body: string
}

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function normalizeTimes(times: unknown): string[] {
  if (!Array.isArray(times)) return [...DEFAULT_WRAPUP_TIMES]
  const valid = times.filter((time): time is string => typeof time === 'string' && TIME.test(time))
  return [...new Set(valid)].sort()
}

export function emptyJournal(date: string): WrapupJournal {
  return {
    date,
    open: {},
    handled: {},
    ticked: {},
    fired: [],
    intentions: [],
    intentionsEdited: false,
    intentionsFrom: null,
  }
}

// Each day starts blank: an ask open yesterday and gone this morning was not done today
export function forDay(journal: WrapupJournal, now: Date): WrapupJournal {
  const date = dayKey(now)
  return journal.date === date ? journal : emptyJournal(date)
}

function sourceOf(signalId: string): SourceName {
  const ref = signalId.slice(0, signalId.lastIndexOf(':'))
  return ref.includes('#') ? 'github' : 'linear'
}

// An ask that leaves the flux was handled. A source down proves nothing, so its asks stay open
export function observe(
  previous: WrapupJournal,
  views: TopicView[],
  now: Date,
  healthy: (source: SourceName) => boolean,
): WrapupJournal {
  const journal = forDay(previous, now)
  const at = now.toISOString()
  const current: Record<string, Ask> = {}
  for (const view of views) {
    for (const signal of view.signals) {
      if (signal.rank > LAST_ASK_RANK) continue
      current[signal.id] = {
        topicId: view.topic.id,
        detail: signal.detail,
        rank: signal.rank,
        stamp: signal.stamp,
      }
    }
  }

  const handled = { ...journal.handled }
  const open = { ...current }
  for (const [id, ask] of Object.entries(journal.open)) {
    if (id in current) continue
    if (healthy(sourceOf(id))) handled[id] = { ...ask, at }
    else open[id] = ask
  }
  // Back with nothing newer was a blip; back with a newer event is a second round, the first stays done
  for (const [id, ask] of Object.entries(current)) {
    const done = handled[id]
    if (done && ask.stamp <= done.stamp) delete handled[id]
  }
  return { ...journal, open, handled }
}

export function tick(journal: WrapupJournal, topicId: string, now: Date): WrapupJournal {
  return { ...journal, ticked: { ...journal.ticked, [topicId]: now.toISOString() } }
}

export function untick(journal: WrapupJournal, topicId: string): WrapupJournal {
  const ticked = { ...journal.ticked }
  delete ticked[topicId]
  return { ...journal, ticked }
}

// A topic without PR or ticket is a free task: ticking it is the only way it ever ends
export function isFreeTask(topic: Topic): boolean {
  return !topic.links.some(isLinkedRef)
}

function latest(dates: string[]): string {
  return dates.reduce((max, date) => (date > max ? date : max), '')
}

export interface WrapupInput {
  journal: WrapupJournal
  topics: Topic[]
  views: TopicView[]
  queue: TopicView[]
  merged: MergedPr[]
  times: string[]
  now: Date
  // Whether a topic belongs to the workspace on screen; the journal holds every workspace's day
  visible?: (topic: Topic) => boolean
}

// What was done over a window, read from the wrap-up journals, the topics and the merged PRs
export interface DoneSource {
  handled: HandledAsk[]
  ticked: Record<string, string>
  topics: Topic[]
  views: TopicView[]
  merged: MergedPr[]
  within(iso: string): boolean
}

export interface DoneRecord extends WrapupDone {
  // The highest ask handled on the topic, which names what was done
  askRank: Rank | null
  links: string[]
}

export function collectDone({ handled, ticked, topics, views, merged, within }: DoneSource): DoneRecord[] {
  const inWindow = new Map(
    merged.filter(pr => within(pr.mergedAt)).map(pr => [pr.ref, pr] as const),
  )
  const handledBy = new Map<string, HandledAsk[]>()
  for (const ask of handled) {
    if (!within(ask.at)) continue
    handledBy.set(ask.topicId, [...(handledBy.get(ask.topicId) ?? []), ask])
  }

  const records: DoneRecord[] = []
  const claimed = new Set<string>()
  for (const topic of topics) {
    const merges = topic.links.flatMap(ref => inWindow.get(ref) ?? [])
    const closed = topic.status === 'done' && topic.closedAt !== undefined && within(topic.closedAt)
    const asks = (handledBy.get(topic.id) ?? []).sort((a, b) => a.rank - b.rank)
    const tick = ticked[topic.id]
    if (merges.length === 0 && !closed && asks.length === 0 && !tick) continue
    merges.forEach(pr => claimed.add(pr.ref))

    const outcome: WrapupOutcome =
      merges.length > 0 ? 'merged' : closed ? 'closed' : tick ? 'ticked' : 'handled'
    const view = views.find(entry => entry.topic.id === topic.id)
    records.push({
      id: topic.id,
      topicId: topic.id,
      live: topic.status !== 'done',
      ref: topic.links[0] ?? null,
      title: topic.title,
      detail: asks.length > 0 ? [...new Set(asks.map(ask => ask.detail))].join(' · ') : null,
      url: merges[0]?.url ?? view?.items[0]?.url ?? null,
      outcome,
      at: latest([
        ...merges.map(pr => pr.mergedAt),
        ...(closed && topic.closedAt ? [topic.closedAt] : []),
        ...asks.map(ask => ask.at),
        ...(tick ? [tick] : []),
      ]),
      locked: merges.length > 0 || (!closed && !tick),
      askRank: asks[0]?.rank ?? null,
      links: topic.links,
    })
  }

  for (const pr of inWindow.values()) {
    if (claimed.has(pr.ref)) continue
    records.push({
      id: `merged:${pr.ref}`,
      topicId: null,
      live: false,
      ref: pr.ref,
      title: pr.title,
      detail: null,
      url: pr.url,
      outcome: 'merged',
      at: pr.mergedAt,
      locked: true,
      askRank: null,
      links: [pr.ref],
    })
  }
  return records.sort((a, b) => a.at.localeCompare(b.at))
}

function doneLines({ journal, topics, views, merged, now, visible }: WrapupInput): WrapupDone[] {
  const today = dayKey(now)
  const shown = visible ?? (() => true)
  return collectDone({
    handled: Object.values(journal.handled),
    ticked: journal.ticked,
    topics,
    views,
    merged,
    within: iso => dayKey(new Date(iso)) === today,
  })
    .filter(record => {
      const topic = record.topicId ? topics.find(entry => entry.id === record.topicId) : undefined
      return !topic || shown(topic)
    })
    .map(({ askRank: _rank, links: _links, ...line }) => line)
}

// Ticked in the wrap-up, and nothing new came in since
function settled(view: TopicView, journal: WrapupJournal): boolean {
  const ticked = journal.ticked[view.topic.id]
  return ticked !== undefined && !view.signals.some(signal => signal.stamp > ticked)
}

// An intention is done once the topic leaves my hands, or once ticked with nothing new since
export function intentionDone(view: TopicView | undefined, journal: WrapupJournal): boolean {
  if (!view) return true
  return (view.ball !== 'me' && view.ball !== 'agent') || settled(view, journal)
}

// Today's intentions still to do, then the head of the queue
function focusLines({ journal, views, queue }: WrapupInput): WrapupFocus[] {
  const byId = new Map(views.map(view => [view.topic.id, view]))
  const intentions = journal.intentions.flatMap(id => {
    const view = byId.get(id)
    return view && !intentionDone(view, journal) ? [view] : []
  })
  const picked = new Set(intentions.map(view => view.topic.id))
  const rest = queue.filter(view => !picked.has(view.topic.id) && !settled(view, journal))
  return [...intentions, ...rest].slice(0, FOCUS_SIZE).map(view => ({
    id: view.topic.id,
    topicId: view.topic.id,
    live: true,
    ref: view.topic.links[0] ?? null,
    title: view.topic.title,
    detail: view.signals[0]?.detail ?? null,
    url: view.items[0]?.url ?? null,
    rank: view.rank,
    since: view.since,
  }))
}

export function slotsAround(times: string[], now: Date): { slot: string | null; next: string | null } {
  const clock = clockOf(now)
  const slots = normalizeTimes(times)
  return {
    slot: slots.filter(time => time <= clock).at(-1) ?? null,
    next: slots.find(time => time > clock) ?? null,
  }
}

export function buildWrapup(input: WrapupInput): WrapupView {
  return {
    date: dayKey(input.now),
    ...slotsAround(input.times, input.now),
    done: doneLines(input),
    focus: focusLines(input),
  }
}

// The latest slot reached and not yet settled. A meeting holds it back until it ends;
// a slot missed by too much is settled silently
export function dueSlot(
  times: string[],
  journal: WrapupJournal,
  now: Date,
  meeting: Meeting | null,
): { notify: string | null; fired: string[] } {
  const unchanged = { notify: null, fired: journal.fired }
  if (now.getDay() === 0 || now.getDay() === 6) return unchanged
  const { slot } = slotsAround(times, now)
  if (!slot || journal.fired.includes(slot)) return unchanged
  const late = now.getHours() * 60 + now.getMinutes() - minutesOf(slot)
  if (late > GRACE_MINUTES) return { notify: null, fired: [...journal.fired, slot] }
  if (meeting) return unchanged
  return { notify: slot, fired: [...journal.fired, slot] }
}

export function wrapupNotification(view: WrapupView, slot: string): WrapupNotification {
  const count = view.done.length
  const done =
    count === 0
      ? 'Rien de bouclé pour l’instant'
      : `${count} ${count > 1 ? 'tâches bouclées' : 'tâche bouclée'}`
  const lead = view.focus[0]
  const focus = lead
    ? `focus : ${[lead.ref, lead.detail].filter(Boolean).join(', ') || lead.title}`
    : 'rien ne t’attend'
  return { title: `Wrap-up de ${slot}`, body: `${done} · ${focus}` }
}
