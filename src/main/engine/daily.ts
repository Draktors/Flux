import { countLabel, YESTERDAY_LABEL } from '../../shared/dailyLabels'
import { markedBlocked } from '../../shared/titles'
import type {
  DailyBlocker,
  DailyIntention,
  DailyRun,
  DailySheet,
  DailyYesterday,
  HealthLevel,
  Meeting,
  MergedPr,
  Rank,
  RankCount,
  RefPill,
  Topic,
  TopicView,
  YesterdayKind,
} from '../../shared/types'
import type { GitActivity } from '../sources/commits'
import { isLinkedRef } from './ball'
import { ticketKeys } from './rank'
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
  // Whether a topic belongs to the workspace on screen; everything does without workspaces
  visible?: (topic: Topic) => boolean
  // Your commits and uncommitted work in this workspace's repos, since the previous workday
  git?: GitActivity | null
  // Meetings of this workspace since the previous workday, already over
  meetings?: Meeting[]
  // Ticket prefixes of the workspace (DEVPP, CCM…), to read keys in branch names
  ticketPrefixes?: string[]
}

// Ticket keys in a branch or commit message: feature/CCM-11_sms names CCM-11, whatever the case
// or what follows; with known prefixes, only those count, so step-2 is never a ticket
export function branchTickets(text: string, prefixes: string[] = []): string[] {
  const keys = new Set<string>()
  for (const match of text.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,6})(?!\d)/g)) {
    const prefix = match[1].toUpperCase()
    if (prefixes.length > 0 ? prefixes.includes(prefix) : /^[A-Z][A-Z0-9]+$/.test(match[1])) {
      keys.add(`${prefix}-${match[2]}`)
    }
  }
  return prefixes.length > 0 ? [...keys] : [...new Set([...keys, ...ticketKeys(text)])]
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
  const visible = input.visible ?? (() => true)
  const shown = records.filter(record => {
    const topic = record.topicId ? topics.find(entry => entry.id === record.topicId) : undefined
    return !topic || visible(topic)
  })
  const lines: DailyYesterday[] = shown.map(record => ({
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
    if (topic && !visible(topic)) continue
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
    if (topic && !visible(topic)) continue
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
  lines.push(...gitLines(input, titles, urls, new Set([...seen, ...lines.flatMap(line => line.refs.map(pill => pill.ref))])))
  lines.push(...meetingLines(input, titles))
  return lines.sort((a, b) => a.at.localeCompare(b.at))
}

// A branch's commits make one line, named after its ticket; a branch whose ticket already has a
// line (merged, closed…) adds nothing new
export function gitLines(
  input: Pick<DailyInput, 'git' | 'now' | 'ticketPrefixes'>,
  titles: Record<string, string>,
  urls: Map<string, string>,
  seen: Set<string> = new Set(),
): DailyYesterday[] {
  const git = input.git
  if (!git) return []
  const branchOf = (ref: string) => ref.replace(/^refs\/(heads|remotes\/[^/]+)\//, '')
  const groups = new Map<string, { repo: string; branch: string; subjects: string[]; at: string }>()
  for (const commit of git.commits) {
    if (commit.ref === 'refs/stash') continue
    const branch = branchOf(commit.ref)
    const key = `${commit.repo}:${branch}`
    const group = groups.get(key) ?? { repo: commit.repo, branch, subjects: [], at: commit.at }
    group.subjects.push(commit.subject)
    if (commit.at > group.at) group.at = commit.at
    groups.set(key, group)
  }
  const lines: DailyYesterday[] = []
  for (const [key, group] of groups) {
    const refs = branchTickets(`${group.branch} ${group.subjects.join(' ')}`, input.ticketPrefixes)
    if (refs.some(ref => seen.has(ref))) continue
    const id = `pushed:${key}`
    const latest = group.subjects[group.subjects.length - 1] ?? group.branch
    const count = group.subjects.length
    lines.push({
      id,
      topicId: null,
      live: false,
      title: refs[0] ? `${refs[0]} — ${latest}` : latest,
      short: titles[id] ?? null,
      refs: refs.map(ref => ({ ref, url: urls.get(ref) ?? null })),
      url: null,
      kind: 'pushed',
      at: new Date(group.at).toISOString(),
      note: `${count} commit${count > 1 ? 's' : ''} sur ${group.branch}`,
    })
  }
  for (const work of git.uncommitted) {
    const id = `wip:${work.repo}:${work.branch}`
    const refs = branchTickets(work.branch, input.ticketPrefixes)
    lines.push({
      id,
      topicId: null,
      live: false,
      title: refs[0] ? `${refs[0]} — ${work.branch}` : work.branch || work.repo,
      short: titles[id] ?? null,
      refs: refs.map(ref => ({ ref, url: urls.get(ref) ?? null })),
      url: null,
      kind: 'wip',
      at: input.now.toISOString(),
      note: `${work.files.length} fichier${work.files.length > 1 ? 's' : ''} pas encore poussé${work.files.length > 1 ? 's' : ''}, dans ${work.repo}`,
    })
  }
  return lines
}

export function meetingLines(
  input: Pick<DailyInput, 'meetings' | 'run'>,
  titles: Record<string, string>,
): DailyYesterday[] {
  const outcomes = input.run.content?.meetings ?? {}
  return (input.meetings ?? []).map(meeting => {
    const id = `meeting:${meeting.start}`
    return {
      id,
      topicId: null,
      live: false,
      title: meeting.title,
      short: titles[id] ?? null,
      refs: [],
      url: null,
      kind: 'meeting' as const,
      at: meeting.start,
      note: outcomes[id] ?? null,
    }
  })
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

  // The journal holds every workspace's intentions: this daily only shows its own
  const visible = input.visible ?? (() => true)
  const topicOf = (id: string) => byId.get(id)?.topic ?? topics.find(entry => entry.id === id)
  const mine = today.intentions.filter(id => {
    const topic = topicOf(id)
    return topic !== undefined && visible(topic)
  })
  const ids = mine.length > 0 ? mine : intentionIds({ ...today, intentions: [] }, queue)
  const intentions = ids.flatMap(id => {
    const view = byId.get(id)
    const topic = topicOf(id)
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
    standup: content?.standup ?? null,
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
  const lines = [`# Daily — ${sheet.date}`, '', stamp, '', '## Stand-up', '']
  if (sheet.standup) lines.push(`> ${sheet.standup}`, '')
  lines.push('**Hier**', '')
  if (sheet.yesterday.length === 0) lines.push('RAS')
  for (const line of sheet.yesterday) {
    const note = line.note ? ` — ${line.note}` : ''
    lines.push(`- ${YESTERDAY_LABEL[line.kind]} · ${lineText(line)}${note}`)
  }
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
