import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppState,
  DailyState,
  Item,
  MergedPr,
  Meeting,
  SourceHealth,
  SourceName,
  SourceProgress,
  Topic,
  TopicView,
} from '../../shared/types'
import { RANKS } from '../../shared/ranks'
import { NOTIFY_FILE, SNAPSHOT_FILE, STATE_DIR, WRAPUP_DIR } from '../paths'
import { fetchAgents } from '../sources/agents'
import { fetchGithub, type GithubSnapshot } from '../sources/github'
import type { SettingsStore } from '../store/settings'
import type { TopicStore } from '../store/topics'
import { compareViews, reconcile, type LiveSession } from './ball'
import { decide, EMPTY_NOTIFY_STATE, type FluxNotification, type NotifyState } from './notify'
import { itemFromPullRequest, itemFromTicket, type Ticket } from './rank'
import {
  buildWrapup,
  dayKey,
  dueSlot,
  emptyJournal,
  forDay,
  isFreeTask,
  observe,
  tick,
  untick,
  wrapupNotification,
  type WrapupJournal,
  type WrapupNotification,
} from './wrapup'

const TICK_MS = 60_000
const CALENDAR_EVERY_TICKS = 15

export interface FluxHooks {
  onState(state: AppState): void
  // Each source as soon as it answers, so the first load can show its progress
  onProgress?(progress: SourceProgress): void
  onNotify(notification: FluxNotification): void
  onWrapup(notification: WrapupNotification): void
  fetchTickets(keys: string[]): Promise<Ticket[] | null>
  fetchMeetings(): Promise<Meeting[] | null>
  closeThreads(topic: Topic): Promise<void>
  // Resolves the session id of threads opened in Claude Desktop; returns the topics it changed
  adoptThreads(topics: Topic[]): Promise<Topic[]>
  onTick(now: Date, state: AppState): void
}

function previousWorkday(now: Date): string {
  const date = new Date(now)
  do {
    date.setDate(date.getDate() - 1)
  } while (date.getDay() === 0 || date.getDay() === 6)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function emptyHealth(): Record<SourceName, SourceHealth> {
  return {
    github: { ok: false, at: null },
    linear: { ok: false, at: null, error: 'Clef API non renseignée' },
    agents: { ok: false, at: null },
    calendar: { ok: false, at: null, error: 'Adresse iCal non renseignée' },
  }
}

function journalFile(date: string): string {
  return join(WRAPUP_DIR, `${date}.json`)
}

function readJournal(now: Date): WrapupJournal {
  const date = dayKey(now)
  const path = journalFile(date)
  if (!existsSync(path)) return emptyJournal(date)
  try {
    return { ...emptyJournal(date), ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<WrapupJournal>), date }
  } catch {
    return emptyJournal(date)
  }
}

function summarize(view: TopicView) {
  const lead = view.signals[0]
  return {
    title: view.topic.title,
    links: view.topic.links,
    rank: view.rank,
    rankLabel: view.rank === null ? null : RANKS[view.rank].label,
    detail: lead?.detail ?? null,
    since: view.since,
    url: view.items[0]?.url ?? null,
    blocked: view.topic.blocked ?? null,
  }
}

export class Flux {
  private topics: Topic[] = []
  private github: GithubSnapshot | null = null
  private tickets: Ticket[] = []
  private sessions: LiveSession[] = []
  private meetings: Meeting[] = []
  private health = emptyHealth()
  private notifyState: NotifyState = EMPTY_NOTIFY_STATE
  private daily: DailyState = { date: '', status: 'none' }
  private journal: WrapupJournal = emptyJournal('')
  private savedJournal = ''
  private state: AppState | null = null
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private queued = false
  private tickCount = 0
  // No state before the first sync: an early rebuild would publish an empty flux and skip the loading scene
  private synced = false

  constructor(
    private readonly store: TopicStore,
    private readonly settings: SettingsStore,
    private readonly hooks: FluxHooks,
  ) {}

  async start(): Promise<void> {
    mkdirSync(STATE_DIR, { recursive: true })
    if (existsSync(NOTIFY_FILE)) {
      this.notifyState = {
        ...EMPTY_NOTIFY_STATE,
        ...(JSON.parse(readFileSync(NOTIFY_FILE, 'utf8')) as Partial<NotifyState>),
      }
    }
    this.journal = readJournal(new Date())
    this.savedJournal = JSON.stringify(this.journal)
    this.topics = await this.store.load()
    this.store.watch(() => void this.reload())
    await this.tick()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.store.stop()
  }

  current(): AppState | null {
    return this.state
  }

  topic(id: string): Topic | undefined {
    return this.topics.find(topic => topic.id === id)
  }

  view(id: string): TopicView | undefined {
    const state = this.state
    if (!state) return undefined
    const views = [...state.queue, ...state.active, ...state.waiting, ...state.dormant, ...state.notes]
    return views.find(view => view.topic.id === id)
  }

  liveSessions(): LiveSession[] {
    return this.sessions
  }

  setDaily(daily: DailyState): void {
    this.daily = daily
    void this.rebuild()
  }

  async addTopic(topic: Topic): Promise<void> {
    await this.store.save(topic)
    this.topics.push(topic)
    await this.rebuild()
  }

  async saveTopic(topic: Topic): Promise<void> {
    await this.store.save(topic)
    await this.rebuild()
  }

  async closeTopic(id: string): Promise<void> {
    const topic = this.topic(id)
    if (!topic || topic.status === 'done') return
    await this.close(topic)
    await this.rebuild()
  }

  private async close(topic: Topic): Promise<void> {
    topic.status = 'done'
    topic.closedAt = new Date().toISOString()
    await this.hooks.closeThreads(topic)
    await this.store.save(topic)
  }

  // A free task ticked closes, a closed topic unticked reopens; what the sources settled stays as is
  async checkWrapup(id: string, done: boolean): Promise<void> {
    const wrapup = this.state?.wrapup
    const line = [...(wrapup?.done ?? []), ...(wrapup?.focus ?? [])].find(entry => entry.id === id)
    if (!line?.topicId || ('locked' in line && line.locked)) return
    const topic = this.topic(line.topicId)
    if (!topic) return
    const now = new Date()
    this.journal = forDay(this.journal, now)
    if (done) {
      this.journal = tick(this.journal, topic.id, now)
      if (isFreeTask(topic) && topic.status !== 'done') await this.close(topic)
    } else {
      this.journal = untick(this.journal, topic.id)
      if (topic.status === 'done') {
        topic.status = 'open'
        topic.closedAt = undefined
        await this.store.save(topic)
      }
    }
    await this.rebuild()
  }

  async refresh(): Promise<void> {
    await this.tick()
  }

  // Manual refresh: lets a tick in flight finish, then refetches every source, calendar included
  async refreshAll(): Promise<void> {
    while (this.ticking) await new Promise(resolve => setTimeout(resolve, 200))
    this.tickCount = 0
    await this.tick()
  }

  async reloadSources(): Promise<void> {
    this.tickCount = 0
    await this.tick()
  }

  private async reload(): Promise<void> {
    this.topics = await this.store.load()
    await this.rebuild()
  }

  private track(source: SourceName, error?: unknown): void {
    const at = new Date().toISOString()
    this.health[source] = error
      ? { ok: false, at: this.health[source].at, error: (error as Error).message }
      : { ok: true, at }
    this.hooks.onProgress?.({ source, ok: !error })
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      this.queued = true
      return
    }
    this.ticking = true
    try {
      this.topics = await this.store.load()
      await this.adoptThreads()
      const now = new Date()
      const refs = this.topics.filter(topic => topic.status !== 'done').flatMap(topic => topic.links)

      await Promise.all([
        fetchGithub(refs.filter(ref => ref.includes('#')), previousWorkday(now))
          .then(snapshot => {
            this.github = snapshot
            this.track('github')
          })
          .catch(error => this.track('github', error)),
        fetchAgents()
          .then(sessions => {
            this.sessions = sessions
            this.track('agents')
          })
          .catch(error => this.track('agents', error)),
        this.hooks
          .fetchTickets(refs.filter(ref => !ref.includes('#')))
          .then(tickets => {
            if (tickets === null) return
            this.tickets = tickets
            this.track('linear')
          })
          .catch(error => this.track('linear', error)),
      ])

      if (this.tickCount % CALENDAR_EVERY_TICKS === 0) {
        await this.hooks
          .fetchMeetings()
          .then(meetings => {
            if (meetings === null) return
            this.meetings = meetings
            this.track('calendar')
          })
          .catch(error => this.track('calendar', error))
      }
      this.tickCount += 1
      this.synced = true

      await this.rebuild(true)
      await this.sweepClosingThreads()
      if (this.state) this.hooks.onTick(new Date(), this.state)
    } finally {
      this.ticking = false
      if (this.queued) {
        this.queued = false
        void this.tick()
      }
    }
  }

  async adoptThreads(): Promise<void> {
    const changed = await this.hooks.adoptThreads(this.topics).catch(() => [])
    for (const topic of changed) await this.store.save(topic)
  }

  private async sweepClosingThreads(): Promise<void> {
    for (const topic of this.topics) {
      if (topic.status !== 'done' || !topic.threads.some(thread => thread.closing)) continue
      await this.hooks.closeThreads(topic)
      await this.store.save(topic)
    }
  }

  private items(now: Date): Item[] {
    const me = this.github?.me
    const context = { me: me ?? '', now }
    return [
      ...(this.github?.pullRequests ?? []).map(pr => itemFromPullRequest(pr, context)),
      ...this.tickets.map(ticket => itemFromTicket(ticket, context)),
    ]
  }

  private meetingStatus(now: Date): AppState['meeting'] {
    const iso = now.toISOString()
    return {
      current: this.meetings.find(meeting => meeting.start <= iso && meeting.end > iso) ?? null,
      next: this.meetings.find(meeting => meeting.start > iso) ?? null,
    }
  }

  private async rebuild(notify = false): Promise<void> {
    if (!this.synced) return
    const now = new Date()
    const result = reconcile(this.topics, this.items(now), this.sessions, now)

    for (const topic of result.created) {
      this.topics.push(topic)
      await this.store.save(topic)
    }
    for (const id of result.reopened) {
      const topic = this.topic(id)
      if (topic) await this.store.save(topic)
    }
    for (const { id } of result.linked) {
      const topic = this.topic(id)
      if (topic) await this.store.save(topic)
    }
    for (const id of result.closed) {
      const topic = this.topic(id)
      if (topic) await this.close(topic)
    }

    const views = result.views
    const pick = (ball: TopicView['ball']) =>
      views
        .filter(view => view.topic.status === 'open' && view.ball === ball)
        .sort(compareViews)
    const meeting = this.meetingStatus(now)
    const queue = pick('me')
    this.journal = observe(this.journal, views, now, source => this.health[source].ok)
    const times = this.settings.values.wrapupTimes
    const wrapup = buildWrapup({
      journal: this.journal,
      topics: this.topics,
      views,
      queue,
      merged: this.github?.merged ?? [],
      times,
      now,
    })
    const state: AppState = {
      generatedAt: now.toISOString(),
      queue,
      active: views.filter(view => view.ball === 'agent'),
      waiting: pick('others'),
      dormant: pick('dormant'),
      notes: views.filter(view => view.topic.status === 'inbox' && view.ball !== 'agent'),
      loose: result.loose.filter(item => item.ball === 'others'),
      sources: this.health,
      meeting,
      daily: this.daily,
      wrapup,
    }
    this.state = state
    this.hooks.onState(state)
    await this.writeSnapshot(state)

    if (notify) {
      const due = dueSlot(times, this.journal, now, meeting.current)
      this.journal = { ...this.journal, fired: due.fired }
      if (due.notify) this.hooks.onWrapup(wrapupNotification(wrapup, due.notify))
    }
    await this.saveJournal()

    if (notify && this.health.github.ok) {
      const { workdayStart, workdayEnd } = this.settings.values
      const decision = decide(this.notifyState, state.queue, {
        now,
        meeting: meeting.current,
        workdayStart,
        workdayEnd,
      })
      this.notifyState = decision.state
      await writeFile(NOTIFY_FILE, JSON.stringify(decision.state))
      decision.notifications.forEach(notification => this.hooks.onNotify(notification))
    }
  }

  private async saveJournal(): Promise<void> {
    const content = JSON.stringify(this.journal)
    if (content === this.savedJournal) return
    await mkdir(WRAPUP_DIR, { recursive: true })
    const path = journalFile(this.journal.date)
    const draft = `${path}.${randomUUID()}.tmp`
    await writeFile(draft, content)
    await rename(draft, path)
    this.savedJournal = content
  }

  private async writeSnapshot(state: AppState): Promise<void> {
    const merged: MergedPr[] = this.github?.merged ?? []
    const snapshot = {
      generatedAt: state.generatedAt,
      sources: state.sources,
      queue: state.queue.map(summarize),
      active: state.active.map(summarize),
      waitingOnOthers: [
        ...state.waiting.map(summarize),
        ...state.loose.map(item => ({ title: item.title, links: [item.ref], url: item.url })),
      ],
      dormant: state.dormant.map(summarize),
      notes: state.notes.map(summarize),
      mergedSincePreviousWorkday: merged,
    }
    const draft = `${SNAPSHOT_FILE}.${randomUUID()}.tmp`
    await writeFile(draft, JSON.stringify(snapshot, null, 2))
    await rename(draft, SNAPSHOT_FILE)
  }
}
