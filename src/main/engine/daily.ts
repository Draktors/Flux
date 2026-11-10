import { countLabel, YESTERDAY_LABEL } from '../../shared/dailyLabels'
import { markedBlocked } from '../../shared/titles'
import type {
  DailyBlocker,
  DailyIntention,
  DailyRun,
  DailySheet,
  DailyYesterday,
  HealthLevel,
  MergedPr,
  Rank,
  RankCount,
  RefPill,
  Topic,
  TopicView,
  YesterdayKind,
} from '../../shared/types'
import { isLinkedRef } from './ball'
import { collectDone, dayKey, intentionDone, type DoneRecord, type WrapupJournal } from './wrapup'

export const PROPOSED_INTENTIONS = 3
export const MAX_INTENTIONS = 5
const CANDIDATES = 8

// What GitHub and Linear say was done, for a day Flux did not keep a journal of
export interface ReviewedPr {
  ref: string
  title: string
  url: string
  reviewedAt: string
}

export interface CompletedTicket {
  key: string
  title: string
  url: string
  completedAt: string
}

export interface DailyFallback {
  reviewed: ReviewedPr[]
  completed: CompletedTicket[]
}

export function previousWorkday(now: Date): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  do {
    date.setDate(date.getDate() - 1)
  } while (date.getDay() === 0 || date.getDay() === 6)
  return date
}

// From the previous workday to today: a Monday reads Friday, the weekend and the morning
export function windowDays(now: Date): string[] {
  const today = dayKey(now)
  const days: string[] = []
  for (const cursor = previousWorkday(now); dayKey(cursor) <= today; cursor.setDate(cursor.getDate() + 1)) {
    days.push(dayKey(cursor))
  }
  return days
}

const ASK_KIND: Partial<Record<Rank, YesterdayKind>> = {
  0: 'submitted',
  1: 'feedback',
  2: 'reviewed',
  3: 'answered',
}

// The ask a topic answered says more than closing or ticking it did
export function yesterdayKind(record: Pick<DoneRecord, 'outcome' | 'askRank'>): YesterdayKind {
  if (record.outcome === 'merged') return 'merged'
  const ask = record.askRank === null ? undefined : ASK_KIND[record.askRank]
  if (ask) return ask
  if (record.outcome === 'closed') return 'closed'
  if (record.outcome === 'ticked') return 'ticked'
  return 'handled'
}

export interface DailyInput {
  now: Date
  // Journals of the window, today's included
  journals: WrapupJournal[]
  today: WrapupJournal
  topics: Topic[]
  views: TopicView[]
  queue: TopicView[]
  active: TopicView[]
  merged: MergedPr[]
  fallback: DailyFallback | null
  run: DailyRun
  skill: DailySheet['skill']
  dailyTime: string
  notePath: string | null
}

function urlsOf({ views, merged, fallback }: DailyInput): Map<string, string> {
  const urls = new Map<string, string>()
  for (const view of views) for (const item of view.items) urls.set(item.ref, item.url)
  for (const pr of merged) urls.set(pr.ref, pr.url)
  for (const pr of fallback?.reviewed ?? []) urls.set(pr.ref, pr.url)
  for (const ticket of fallback?.completed ?? []) urls.set(ticket.key, ticket.url)
  return urls
}

function pills(links: string[], urls: Map<string, string>): RefPill[] {
  return links.filter(isLinkedRef).map(ref => ({ ref, url: urls.get(ref) ?? null }))
}

function latestTicks(journals: WrapupJournal[]): Record<string, string> {
  const ticked: Record<string, string> = {}
  for (const journal of journals) {
    for (const [id, at] of Object.entries(journal.ticked)) {
      if (!ticked[id] || at > ticked[id]) ticked[id] = at
    }
  }
  return ticked
}

function yesterdayLines(input: DailyInput, titles: Record<string, string>, urls: Map<string, string>): DailyYesterday[] {
  const { now, journals, topics, views, merged, fallback } = input
  const start = previousWorkday(now).getTime()
  const within = (iso: string) => new Date(iso).getTime() >= start
  const records = collectDone({
    handled: journals.flatMap(journal => Object.values(journal.handled)),
    ticked: latestTicks(journals),
    topics,
    views,
    merged,
    within,
  })
  const lines: DailyYesterday[] = records.map(record => ({
    id: record.id,
    topicId: record.topicId,
    live: record.live,
    title: record.title,
    short: titles[record.id] ?? null,
    refs: pills(record.links, urls),
    url: record.url,
    kind: yesterdayKind(record),
    at: record.at,
  }))

  const seen = new Set(records.flatMap(record => record.links))
  const holder = (ref: string) => topics.find(topic => topic.links.includes(ref))
  for (const pr of fallback?.reviewed ?? []) {
    if (seen.has(pr.ref) || !within(pr.reviewedAt)) continue
    const topic = holder(pr.ref)
    const id = topic?.id ?? `reviewed:${pr.ref}`
    lines.push({
      id,
      topicId: topic?.id ?? null,
      live: topic !== undefined && topic.status !== 'done',
      title: topic?.title ?? `${pr.ref} — ${pr.title}`,
      short: titles[id] ?? null,
      refs: pills(topic?.links ?? [pr.ref], urls),
      url: pr.url,
      kind: 'reviewed',
      at: pr.reviewedAt,
    })
  }
  for (const ticket of fallback?.completed ?? []) {
    if (seen.has(ticket.key) || !within(ticket.completedAt)) continue
    const topic = holder(ticket.key)
    const id = topic?.id ?? `completed:${ticket.key}`
    lines.push({
      id,
      topicId: topic?.id ?? null,
      live: topic !== undefined && topic.status !== 'done',
      title: topic?.title ?? `${ticket.key} — ${ticket.title}`,
      short: titles[id] ?? null,
      refs: pills(topic?.links ?? [ticket.key], urls),
      url: ticket.url,
      kind: 'closed',
      at: ticket.completedAt,
    })
  }
  return lines.sort((a, b) => a.at.localeCompare(b.at))
}

function intentionLine(
  topic: Topic,
  view: TopicView | undefined,
  done: boolean,
  titles: Record<string, string>,
  urls: Map<string, string>,
): DailyIntention {
  return {
    id: topic.id,
    topicId: topic.id,
    live: topic.status !== 'done',
    title: topic.title,
    short: titles[topic.id] ?? null,
    refs: pills(topic.links, urls),
    url: view?.items[0]?.url ?? urls.get(topic.links[0] ?? '') ?? null,
    rank: view?.rank ?? null,
    detail: view?.signals[0]?.detail ?? null,
    done,
  }
}

// Today's intentions as the journal holds them, or the head of the queue until the daily proposes
export function intentionIds(today: WrapupJournal, queue: TopicView[]): string[] {
  if (today.intentions.length > 0) return today.intentions
  return queue.slice(0, PROPOSED_INTENTIONS).map(view => view.topic.id)
}

function blockerLines(views: TopicView[], unblock: Record<string, string>, titles: Record<string, string>, urls: Map<string, string>): DailyBlocker[] {
  return views
    .filter(view => view.topic.status !== 'done' && (view.topic.blocked || markedBlocked(view.topic.title)))
    .map(view => ({
      id: view.topic.id,
      topicId: view.topic.id,
      live: true,
      title: view.topic.title,
      short: titles[view.topic.id] ?? null,
      refs: pills(view.topic.links, urls),
      url: view.items[0]?.url ?? null,
      reason:
        view.topic.blocked ??
        (/\[DO NOT MERGE\]/.test(view.topic.title) ? 'Marquée DO NOT MERGE' : 'Marquée BLOCKED'),
      unblock: unblock[view.topic.id] ?? null,
    }))
}

export function rankCounts(queue: TopicView[]): RankCount[] {
  const counts = new Map<Rank, RankCount>()
  for (const view of queue) {
    if (view.rank === null) continue
    const count = counts.get(view.rank)
    if (count) count.count += 1
    else counts.set(view.rank, { rank: view.rank, count: 1, firstId: view.topic.id })
  }
  return [...counts.values()].sort((a, b) => a.rank - b.rank)
}

export function buildDaily(input: DailyInput): DailySheet {
  const { now, today, topics, views, queue, active, run } = input
  const date = dayKey(now)
  const current = run.date === date ? run : { date, status: 'none' as const }
  const content = current.content
  const titles = content?.titles ?? {}
  const urls = urlsOf(input)
  const byId = new Map(views.map(view => [view.topic.id, view]))

  const ids = intentionIds(today, queue)
  const intentions = ids.flatMap(id => {
    const view = byId.get(id)
    const topic = view?.topic ?? topics.find(entry => entry.id === id)
    return topic ? [intentionLine(topic, view, intentionDone(view, today), titles, urls)] : []
  })
  const taken = new Set(ids)
  const candidates = [...new Map([...queue.slice(0, CANDIDATES), ...active].map(view => [view.topic.id, view])).values()]
    .filter(view => !taken.has(view.topic.id))
    .map(view => intentionLine(view.topic, view, false, titles, urls))

  return {
    date,
    status: current.status,
    error: current.error,
    skill: input.skill,
    dailyTime: input.dailyTime,
    generatedAt: content?.generatedAt ?? null,
    notePath: input.notePath,
    since: dayKey(previousWorkday(now)),
    yesterday: yesterdayLines(input, titles, urls),
    intentions,
    intentionsEdited: today.intentionsEdited,
    candidates,
    blockers: blockerLines(views, content?.unblock ?? {}, titles, urls),
    health: content?.health ?? null,
    counts: rankCounts(queue),
  }
}

const HEALTH_MARK: Record<HealthLevel, string> = {
  alert: '🔴',
  weak: '🟡',
  positive: '🟢',
  ok: '⚪',
  unavailable: '⚫',
}

function clockOf(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function lineText(line: { short: string | null; title: string; refs: RefPill[] }): string {
  const title = line.short ?? line.title.replace(/^(?:[a-z0-9_-]+#\d+|[A-Z]{2,5}-\d+) — /, '')
  const refs = line.refs.map(pill => pill.ref)
  return refs.length > 0 ? `${title} (${refs.join(', ')})` : title
}

// The vault note, in the same short shape as the tab
export function renderDailyNote(sheet: DailySheet, now: Date): string {
  const stamp = sheet.generatedAt ? `généré le ${clockOf(sheet.generatedAt)}` : `exporté le ${clockOf(now.toISOString())}`
  const lines = [`# Daily — ${sheet.date}`, '', stamp, '', '## Stand-up', '', '**Hier**', '']
  if (sheet.yesterday.length === 0) lines.push('RAS')
  for (const line of sheet.yesterday) lines.push(`- ${YESTERDAY_LABEL[line.kind]} · ${lineText(line)}`)
  lines.push('', '**Aujourd’hui**', '')
  if (sheet.intentions.length === 0) lines.push('RAS')
  sheet.intentions.forEach((line, index) => {
    lines.push(`${index + 1}. ${line.done ? '~~' : ''}${lineText(line)}${line.done ? '~~' : ''}`)
  })
  lines.push('', '**Bloquants**', '')
  if (sheet.blockers.length === 0) lines.push('RAS')
  for (const line of sheet.blockers) {
    const move = line.unblock ? ` · pour avancer : ${line.unblock}` : ''
    lines.push(`- ${lineText(line)} — ${line.reason}${move}`)
  }
  lines.push('', '## Santé prod', '')
  if (!sheet.health || sheet.health.length === 0) lines.push(sheet.health ? 'RAS' : 'Non généré')
  for (const line of sheet.health ?? []) {
    const text = line.level === 'unavailable' ? 'non consulté' : line.text
    const detail = line.level === 'alert' && line.detail ? ` — ${line.detail}` : ''
    const link = line.url ? ` ([voir](${line.url}))` : ''
    lines.push(`- ${HEALTH_MARK[line.level]} **${line.source}** : ${text}${detail}${link}`)
  }
  lines.push('', '## File', '')
  lines.push(sheet.counts.length > 0 ? sheet.counts.map(count => countLabel(count.rank, count.count)).join(' · ') : 'Vide')
  return `${lines.join('\n')}\n`
}
