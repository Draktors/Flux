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
  return { date, open: {}, handled: {}, ticked: {}, fired: [] }
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
}

function doneLines({ journal, topics, views, merged, now }: WrapupInput): WrapupDone[] {
  const today = dayKey(now)
  const isToday = (iso: string | undefined) => iso !== undefined && dayKey(new Date(iso)) === today
  const mergedToday = new Map(
    merged.filter(pr => isToday(pr.mergedAt)).map(pr => [pr.ref, pr] as const),
  )
  const handledBy = new Map<string, HandledAsk[]>()
  for (const ask of Object.values(journal.handled)) {
    handledBy.set(ask.topicId, [...(handledBy.get(ask.topicId) ?? []), ask])
  }

  const lines: WrapupDone[] = []
  const claimed = new Set<string>()
  for (const topic of topics) {
    const merges = topic.links.flatMap(ref => mergedToday.get(ref) ?? [])
    const closed = topic.status === 'done' && isToday(topic.closedAt)
    const asks = (handledBy.get(topic.id) ?? []).sort((a, b) => a.rank - b.rank)
    const ticked = journal.ticked[topic.id]
    if (merges.length === 0 && !closed && asks.length === 0 && !ticked) continue
    merges.forEach(pr => claimed.add(pr.ref))

    const outcome: WrapupOutcome =
      merges.length > 0 ? 'merged' : closed ? 'closed' : ticked ? 'ticked' : 'handled'
    const view = views.find(entry => entry.topic.id === topic.id)
    lines.push({
      id: topic.id,
      topicId: topic.id,
      live: topic.status !== 'done',
      ref: topic.links[0] ?? null,
      title: topic.title,
      detail: asks.length > 0 ? asks.map(ask => ask.detail).join(' · ') : null,
      url: merges[0]?.url ?? view?.items[0]?.url ?? null,
      outcome,
      at: latest([
        ...merges.map(pr => pr.mergedAt),
        ...(closed && topic.closedAt ? [topic.closedAt] : []),
        ...asks.map(ask => ask.at),
        ...(ticked ? [ticked] : []),
      ]),
      locked: merges.length > 0 || (!closed && !ticked),
    })
  }

  for (const pr of mergedToday.values()) {
    if (claimed.has(pr.ref)) continue
    lines.push({
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
    })
  }
  return lines.sort((a, b) => a.at.localeCompare(b.at))
}

// The head of the queue, minus what was ticked unless something new came in since
function focusLines({ journal, queue }: WrapupInput): WrapupFocus[] {
  return queue
    .filter(view => {
      const ticked = journal.ticked[view.topic.id]
      return !ticked || view.signals.some(signal => signal.stamp > ticked)
    })
    .slice(0, FOCUS_SIZE)
    .map(view => ({
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
