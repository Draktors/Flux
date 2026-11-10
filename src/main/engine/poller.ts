import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
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
import { CONFIG, type Workspace } from '../config'
import { NOTIFY_FILE, SNAPSHOT_FILE, STATE_DIR } from '../paths'
import { fetchAgents } from '../sources/agents'
import { fetchGithub, type GithubSnapshot } from '../sources/github'
import type { SettingsStore } from '../store/settings'
import type { TopicStore } from '../store/topics'
import { allWorkspaces, githubScope, resolveWorkspace, topicVisible, workspaceInfo } from '../workspaces'
import { compareViews, reconcile, type LiveSession } from './ball'
import { decide, EMPTY_NOTIFY_STATE, type FluxNotification, type NotifyState } from './notify'
import { itemFromPullRequest, itemFromTicket, type Ticket } from './rank'

const TICK_MS = 60_000
// A meeting added a few minutes ahead still shows in time
const CALENDAR_EVERY_TICKS = 5
// The workspaces you are not looking at refresh every 5 minutes, so a switch shows warm data
const BACKGROUND_EVERY_TICKS = 5

// What GitHub and Jira last returned for one workspace
interface WorkspaceCache {
  github: GithubSnapshot | null
  // Account the snapshot was read as, so an account switch never shows the other account's queue
  githubAccount: string | null
  githubAt?: string
  jira: Ticket[]
}

export interface FluxHooks {
  onState(state: AppState): void
  // Each source as soon as it answers, so the first load can show its progress
  onProgress?(progress: SourceProgress): void
  onNotify(notification: FluxNotification): void
  fetchTickets(keys: string[]): Promise<Ticket[] | null>
  // Jira tickets of the active workspace; null when Jira is not configured
  fetchJira(keys: string[], projects: string[]): Promise<Ticket[] | null>
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
    linear: { ok: false, at: null, error: 'Clef API non renseignée', missing: true },
    jira: { ok: false, at: null, error: 'Jira non configuré', missing: true },
    agents: { ok: false, at: null },
    calendar: { ok: false, at: null, error: 'Adresse iCal non renseignée', missing: true },
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
  private tickets: Ticket[] = []
  // Keyed by workspace id ('' without workspaces), so switching never refetches before showing
  private caches = new Map<string, WorkspaceCache>()
  private sessions: LiveSession[] = []
  private meetings: Meeting[] = []
  private health = emptyHealth()
  private notifyState: NotifyState = EMPTY_NOTIFY_STATE
  private daily: DailyState = { date: '', status: 'none' }
  private state: AppState | null = null
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private queued = false
  private tickCount = 0
  // A manual refresh or a wake from sleep re-reads the calendar too
  private calendarDue = false
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

  async refresh(): Promise<void> {
    this.calendarDue = true
    await this.tick()
  }

  private workspace() {
    return resolveWorkspace(allWorkspaces(), this.settings.values.workspace)
  }

  private cache(id: string | null = this.workspace()?.id ?? null): WorkspaceCache {
    const key = id ?? ''
    let entry = this.caches.get(key)
    if (!entry) {
      entry = { github: null, githubAccount: null, jira: [] }
      this.caches.set(key, entry)
    }
    return entry
  }

  // The view comes from the cache at once; the active workspace refreshes behind it
  // Projects changed: other workspaces may now cover other repos, so their data is read again
  // (the next tick fetches every workspace it has nothing for); the visible one stays on screen
  forgetOtherWorkspaces(): void {
    const visible = this.workspace()?.id ?? ''
    for (const key of [...this.caches.keys()]) if (key !== visible) this.caches.delete(key)
  }

  async switchWorkspace(): Promise<void> {
    await this.rebuild()
    void this.tick()
  }

  // Manual refresh: lets a tick in flight finish, then refetches every source, calendar included
  async refreshAll(): Promise<void> {
    while (this.ticking) await new Promise(resolve => setTimeout(resolve, 200))
    this.tickCount = 0
    await this.tick()
  }

  async reloadSources(): Promise<void> {
    const account = this.settings.values.githubAccount
    for (const entry of this.caches.values()) {
      if (entry.githubAccount !== account) entry.github = null
    }
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
      const account = this.settings.values.githubAccount
      const workspace = this.workspace()
      const refs = this.refsFor(workspace)
      const keys = refs.filter(ref => !ref.includes('#'))
      const background =
        this.tickCount % BACKGROUND_EVERY_TICKS === 0
          ? allWorkspaces().filter(entry => entry.id !== workspace?.id)
          : allWorkspaces().filter(
              entry => entry.id !== workspace?.id && !this.cache(entry.id).github,
            )

      await Promise.all([
        this.fetchWorkspace(workspace, account, now, true),
        fetchAgents()
          .then(sessions => {
            this.sessions = sessions
            this.track('agents')
          })
          .catch(error => this.track('agents', error)),
        this.hooks
          .fetchTickets(keys)
          .then(tickets => {
            if (tickets === null) return
            this.tickets = tickets
            this.track('linear')
          })
          .catch(error => this.track('linear', error)),
      ])
      // Warm the other workspaces after the visible one, without holding up its view
      for (const other of background) {
        void this.fetchWorkspace(other, account, now, false)
      }

      if (this.calendarDue || this.tickCount % CALENDAR_EVERY_TICKS === 0) {
        this.calendarDue = false
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

  private refsFor(workspace: Workspace | null): string[] {
    return this.topics
      .filter(topic => topic.status !== 'done' && topicVisible(topic, workspace, allWorkspaces()))
      .flatMap(topic => topic.links)
  }

  // Health only follows the visible workspace; a background failure keeps the last good data
  private async fetchWorkspace(
    workspace: Workspace | null,
    account: string | null,
    now: Date,
    visible: boolean,
  ): Promise<void> {
    const entry = this.cache(workspace?.id ?? null)
    const refs = this.refsFor(workspace)
    await Promise.all([
      fetchGithub(
        refs.filter(ref => ref.includes('#')),
        previousWorkday(now),
        account,
        githubScope(workspace, CONFIG.github.owner),
      )
        .then(snapshot => {
          entry.github = snapshot
          entry.githubAccount = account
          entry.githubAt = new Date().toISOString()
          if (visible) this.track('github')
        })
        .catch(error => {
          if (visible) this.track('github', error)
        }),
      this.hooks
        .fetchJira(
          refs.filter(ref => !ref.includes('#')),
          workspace?.jiraProjects ?? [],
        )
        .then(tickets => {
          if (tickets === null) return
          entry.jira = tickets
          if (visible) this.track('jira')
        })
        .catch(error => {
          if (visible) this.track('jira', error)
        }),
    ])
    // A background workspace that just became visible shows its fresh data now
    if (!visible && workspace?.id === this.workspace()?.id) await this.rebuild()
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

  private items(now: Date, id: string | null = this.workspace()?.id ?? null): Item[] {
    const { github, githubAccount, jira } = this.cache(id)
    // Data read as another GitHub account waits for the next fetch instead of showing
    const pullRequests =
      githubAccount === this.settings.values.githubAccount ? (github?.pullRequests ?? []) : []
    const me = github?.me
    const noReview = new Set(
      allWorkspaces().flatMap(workspace =>
        (workspace.github.noReview ?? []).map(repo => (repo.split('/').at(-1) ?? repo).toLowerCase()),
      ),
    )
    const context = { me: me ?? '', now, noReview }
    return [
      ...pullRequests.map(pr => itemFromPullRequest(pr, context)),
      ...this.tickets.map(ticket => itemFromTicket(ticket, context)),
      ...jira.map(ticket => itemFromTicket(ticket, context)),
    ]
  }

  private meetingStatus(now: Date): AppState['meeting'] {
    const iso = now.toISOString()
    return {
      current: this.meetings.find(meeting => meeting.start <= iso && meeting.end > iso) ?? null,
      next: this.meetings.find(meeting => meeting.start > iso) ?? null,
    }
  }

  private visibleHealth(): AppState['sources'] {
    const sources: AppState['sources'] = { ...this.health }
    if (!this.settings.uses('linear')) delete sources.linear
    if (!this.settings.uses('jira')) delete sources.jira
    if (!this.settings.calendar()) delete sources.calendar
    return sources
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

    const workspace = this.workspace()
    const views = result.views.filter(view =>
      topicVisible(view.topic, workspace, allWorkspaces()),
    )
    const pick = (ball: TopicView['ball']) =>
      views
        .filter(view => view.topic.status === 'open' && view.ball === ball)
        .sort(compareViews)
    const meeting = this.meetingStatus(now)
    const state: AppState = {
      generatedAt: now.toISOString(),
      workspace: workspace?.id ?? null,
      workspaces: allWorkspaces().map(workspaceInfo),
      queue: pick('me'),
      active: views.filter(view => view.ball === 'agent'),
      waiting: pick('others'),
      dormant: pick('dormant'),
      notes: views.filter(view => view.topic.status === 'inbox' && view.ball !== 'agent'),
      loose: result.loose.filter(item => item.ball === 'others'),
      sources: this.visibleHealth(),
      meeting,
      daily: this.daily,
    }
    this.state = state
    this.hooks.onState(state)
    await this.writeSnapshot(state)

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

  // What the daily of one workspace sees: same shape as snapshot.json, computed on a copy of the
  // topics so nothing is saved, and limited to that workspace
  workspaceSnapshot(workspace: Workspace | null, now: Date) {
    const id = workspace?.id ?? null
    const result = reconcile(structuredClone(this.topics), this.items(now, id), this.sessions, now)
    const views = result.views.filter(view => topicVisible(view.topic, workspace, allWorkspaces()))
    const pick = (ball: TopicView['ball']) =>
      views
        .filter(view => view.topic.status === 'open' && view.ball === ball)
        .sort(compareViews)
        .map(summarize)
    const cache = this.cache(id)
    return {
      generatedAt: now.toISOString(),
      // When Flux last read this workspace's PRs; null when it never has since launch
      githubReadAt: cache.github ? (cache.githubAt ?? null) : null,
      queue: pick('me'),
      active: views.filter(view => view.ball === 'agent').map(summarize),
      waitingOnOthers: [
        ...pick('others'),
        ...result.loose
          .filter(item => item.ball === 'others')
          .map(item => ({ title: item.title, links: [item.ref], url: item.url })),
      ],
      dormant: pick('dormant'),
      notes: views.filter(view => view.topic.status === 'inbox' && view.ball !== 'agent').map(summarize),
      mergedSincePreviousWorkday: cache.github?.merged ?? [],
    }
  }

  private async writeSnapshot(state: AppState): Promise<void> {
    const merged: MergedPr[] = this.cache().github?.merged ?? []
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
      upcomingMeetings: this.meetings.filter(meeting => meeting.end > state.generatedAt).slice(0, 10),
    }
    const draft = `${SNAPSHOT_FILE}.${randomUUID()}.tmp`
    await writeFile(draft, JSON.stringify(snapshot, null, 2))
    await rename(draft, SNAPSHOT_FILE)
  }
}
