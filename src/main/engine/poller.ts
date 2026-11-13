import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppState,
  DailyRun,
  DailySheet,
  Item,
  MergedPr,
  Meeting,
  SourceHealth,
  SourceName,
  SourceProgress,
  StoreFeed,
  Topic,
  TopicView,
} from '../../shared/types'
import { RANKS } from '../../shared/ranks'
import { CONFIG, type Workspace } from '../config'
import { DAILY_COMMAND, DAILY_DIR, NOTIFY_FILE, SNAPSHOT_FILE, STATE_DIR, WRAPUP_DIR } from '../paths'
import { workspaceFromText } from '../calls/classify'
import { fetchAgents } from '../sources/agents'
import type { GitActivity } from '../sources/commits'
import { readDesktopSessions, syncThreads, type DesktopSession } from '../threads/sessions'
import { fetchGithub, fetchReviewed, type GithubSnapshot } from '../sources/github'
import type { SettingsStore } from '../store/settings'
import type { TopicStore } from '../store/topics'
import {
  allWorkspaces,
  githubScope,
  ownsRepo,
  resolveWorkspace,
  topicVisible,
  workspaceInfo,
} from '../workspaces'
import { activeViews, compareViews, reconcile, type LiveSession } from './ball'
import {
  buildDaily,
  MAX_INTENTIONS,
  previousWorkday,
  renderDailyNote,
  windowDays,
  type CompletedTicket,
  type DailyFallback,
} from './daily'
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
// A meeting added a few minutes ahead still shows in time
const CALENDAR_EVERY_TICKS = 5
const REVIEWS_EVERY_TICKS = 30
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
  onWrapup(notification: WrapupNotification): void
  fetchTickets(keys: string[]): Promise<Ticket[] | null>
  // Jira tickets of the active workspace; null when Jira is not configured
  fetchJira(keys: string[], projects: string[]): Promise<Ticket[] | null>
  // My tickets completed since an ISO date; empty without Linear
  fetchCompleted(since: string): Promise<CompletedTicket[]>
  // The latest store reviews of the apps followed; null when none is
  fetchReviews(): Promise<StoreFeed | null>
  // Jira tickets of the active workspace; null when Jira is not configured
  fetchJira(keys: string[], projects: string[]): Promise<Ticket[] | null>
  fetchMeetings(): Promise<Meeting[] | null>
  // What the daily reads besides the queue: your commits and the meetings already over
  fetchGitActivity(since: Date): Promise<GitActivity | null>
  fetchMeetingsBetween(from: Date, to: Date): Promise<Meeting[] | null>
  closeThreads(topic: Topic): Promise<void>
  // Resolves the session id of threads opened in Claude Desktop; returns the topics it changed
  adoptThreads(topics: Topic[]): Promise<Topic[]>
  onTick(now: Date, state: AppState): void
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

function journalFile(date: string): string {
  return join(WRAPUP_DIR, `${date}.json`)
}

function readJournalFile(date: string): WrapupJournal | null {
  const path = journalFile(date)
  if (!existsSync(path)) return null
  try {
    return { ...emptyJournal(date), ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<WrapupJournal>), date }
  } catch {
    return null
  }
}

function readJournal(now: Date): WrapupJournal {
  const date = dayKey(now)
  return readJournalFile(date) ?? emptyJournal(date)
}

// Only the repos of the workspace on screen; everything without workspaces
export function gitFor(git: GitActivity | null, workspace: Workspace | null): GitActivity | null {
  if (!git || !workspace) return git
  const ours = (remote: string | null) => remote !== null && ownsRepo(workspace, remote, CONFIG.github.owner)
  return {
    commits: git.commits.filter(commit => ours(commit.remote)),
    uncommitted: git.uncommitted.filter(work => ours(work.remote)),
  }
}

// A meeting whose title names another workspace stays out; one naming none shows everywhere
export function meetingsFor(meetings: Meeting[], workspace: Workspace | null, all: Workspace[]): Meeting[] {
  if (!workspace) return meetings
  return meetings.filter(meeting => {
    const named = workspaceFromText(meeting.title, all)
    return named === null || named === workspace.id
  })
}

// One vault note per day and workspace, like the runs
function notePath(date: string, workspace: string | null = null): string {
  return join(DAILY_DIR, workspace ? `${date}-${workspace}.md` : `${date}.md`)
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
    mine: view.mine,
    asked: view.items.find(item => item.asked)?.asked?.excerpt ?? null,
  }
}

export class Flux {
  private topics: Topic[] = []
  private tickets: Ticket[] = []
  // Keyed by workspace id ('' without workspaces), so switching never refetches before showing
  private caches = new Map<string, WorkspaceCache>()
  private sessions: LiveSession[] = []
  private desktop: DesktopSession[] = []
  private meetings: Meeting[] = []
  private health = emptyHealth()
  private notifyState: NotifyState = EMPTY_NOTIFY_STATE
  // The daily run of each workspace ('' without workspaces), so a switch shows its own
  private dailies = new Map<string, DailyRun>()
  private git: GitActivity | null = null
  private pastMeetings: Meeting[] = []
  private journal: WrapupJournal = emptyJournal('')
  private savedJournal = ''
  // Past days do not change: their journals are read once
  private pastJournals = new Map<string, WrapupJournal | null>()
  protected fallback: DailyFallback | null = null
  private reviews: StoreFeed | null = null
  private fallbackDay = ''
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

  setDaily(run: DailyRun): void {
    this.dailies.set(run.workspace ?? '', run)
    void this.rebuild()
  }

  private dailyRun(): DailyRun {
    return this.dailies.get(this.workspace()?.id ?? '') ?? { date: '', status: 'none' }
  }

  // Whether a topic belongs to the workspace on screen
  private visibleTopic(topic: Topic): boolean {
    return topicVisible(topic, this.workspace(), allWorkspaces())
  }

  // The intentions of other workspaces stay in the journal when this one changes its own
  private withIntentions(ids: string[]): string[] {
    const others = this.journal.intentions.filter(id => {
      const topic = this.topic(id)
      return topic !== undefined && !this.visibleTopic(topic)
    })
    return [...new Set([...others, ...ids])]
  }

  // Set by hand: a later daily run keeps them
  async setIntentions(ids: string[]): Promise<void> {
    const live = new Set(this.state ? [...this.state.queue, ...this.state.active, ...this.state.waiting, ...this.state.dormant].map(view => view.topic.id) : [])
    const kept = [...new Set(ids)].filter(id => live.has(id)).slice(0, MAX_INTENTIONS)
    this.journal = { ...forDay(this.journal, new Date()), intentionsEdited: true }
    this.journal = { ...this.journal, intentions: this.withIntentions(kept) }
    await this.rebuild()
    if (this.state) await this.exportDaily(this.state.daily)
  }

  // Commits and past meetings since the previous workday, read with the calendar
  private async refreshDailyActivity(now: Date): Promise<void> {
    const since = previousWorkday(now)
    const [git, meetings] = await Promise.all([
      this.hooks.fetchGitActivity(since).catch(() => null),
      this.hooks.fetchMeetingsBetween(since, now).catch(() => null),
    ])
    if (git) this.git = git
    if (meetings) this.pastMeetings = meetings.filter(meeting => meeting.end <= now.toISOString())
  }

  // Flux was off the previous workday: GitHub and Linear tell what was done, once a day
  private async loadFallback(now: Date): Promise<void> {
    const today = dayKey(now)
    if (this.fallbackDay === today) return
    const since = previousWorkday(now)
    if (readJournalFile(dayKey(since))) {
      this.fallback = null
      this.fallbackDay = today
      return
    }
    const [reviewed, completed] = await Promise.all([
      fetchReviewed(
        since,
        this.settings.values.githubAccount,
        githubScope(this.workspace(), CONFIG.github.owner),
      ).catch(() => null),
      this.hooks.fetchCompleted(since.toISOString()).catch(() => null),
    ])
    this.fallback = { reviewed: reviewed ?? [], completed: completed ?? [] }
    // A source that did not answer is asked again on the next tick
    if (reviewed !== null && completed !== null) this.fallbackDay = today
  }

  private windowJournals(now: Date): WrapupJournal[] {
    const today = dayKey(now)
    return windowDays(now).flatMap(date => {
      if (date === today) return [this.journal]
      if (!this.pastJournals.has(date)) this.pastJournals.set(date, readJournalFile(date))
      return this.pastJournals.get(date) ?? []
    })
  }

  // The vault note follows the tab, written again whenever the intentions change
  private async exportDaily(sheet: DailySheet): Promise<void> {
    await mkdir(DAILY_DIR, { recursive: true })
    const path = notePath(sheet.date, this.workspace()?.id ?? null)
    await writeFile(`${path}.tmp`, renderDailyNote(sheet, new Date()))
    await rename(`${path}.tmp`, path)
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

      if (this.tickCount % REVIEWS_EVERY_TICKS === 0) {
        await this.hooks
          .fetchReviews()
          .then(feed => {
            this.reviews = feed
          })
          .catch(() => undefined)
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
        await this.refreshDailyActivity(now)
      }
      this.tickCount += 1
      this.synced = true
      if (this.health.github.ok) await this.loadFallback(now)

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
        dayKey(previousWorkday(now)),
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

  // A launched thread gets its conversation id, then every thread follows its Desktop session
  async adoptThreads(): Promise<void> {
    this.desktop = await readDesktopSessions().catch(() => this.desktop)
    const adopted = await this.hooks.adoptThreads(this.topics).catch(() => [])
    const open = this.topics.filter(topic => topic.status !== 'done')
    const synced = syncThreads(open, this.desktop)
    for (const topic of new Set([...adopted, ...synced])) await this.store.save(topic)
  }

  desktopSessions(): DesktopSession[] {
    return this.desktop
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
    const context = { me: me ?? '', now, noReview, statusRules: this.settings.values.statusRules }
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
    const result = reconcile(this.topics, this.items(now), this.sessions, now, this.desktop)

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
    const queue = pick('me')
    const active = activeViews(views)
    this.journal = observe(this.journal, views, now, source => this.health[source].ok)
    // A new daily run proposes the intentions, unless they were set by hand
    const run = this.dailyRun()
    const content = run.date === this.journal.date ? run.content : undefined
    const proposed = content !== undefined && content.generatedAt !== this.journal.intentionsFrom
    if (proposed) {
      this.journal = {
        ...this.journal,
        intentionsFrom: content.generatedAt,
        intentions: this.journal.intentionsEdited
          ? this.journal.intentions
          : this.withIntentions(content.intentions),
      }
    }
    const times = this.settings.values.wrapupTimes
    const wrapup = buildWrapup({
      journal: this.journal,
      topics: this.topics,
      views,
      queue,
      merged: this.cache().github?.merged ?? [],
      times,
      now,
      visible: topic => this.visibleTopic(topic),
    })
    const state: AppState = {
      generatedAt: now.toISOString(),
      workspace: workspace?.id ?? null,
      workspaces: allWorkspaces().map(workspaceInfo),
      queue,
      active,
      waiting: pick('others'),
      dormant: pick('dormant'),
      notes: views.filter(view => view.topic.status === 'inbox' && view.ball !== 'agent'),
      loose: result.loose.filter(item => item.ball === 'others'),
      sources: this.visibleHealth(),
      meeting,
      daily: buildDaily({
        now,
        journals: this.windowJournals(now),
        today: this.journal,
        topics: this.topics,
        views,
        queue,
        active,
        merged: this.cache().github?.merged ?? [],
        fallback: this.fallback,
        reviews: this.reviews,
        run,
        skill: existsSync(DAILY_COMMAND) ? 'ready' : 'missing',
        dailyTime: this.settings.values.dailyTime,
        notePath: existsSync(notePath(dayKey(now), workspace?.id ?? null))
          ? notePath(dayKey(now), workspace?.id ?? null)
          : null,
        visible: topic => this.visibleTopic(topic),
        git: gitFor(this.git, workspace),
        ticketPrefixes: workspace ? [...workspace.jiraProjects, ...(workspace.linearTeams ?? [])] : [],
        meetings: meetingsFor(this.pastMeetings, workspace, allWorkspaces()),
      }),
      wrapup,
    }
    this.state = state
    this.hooks.onState(state)
    await this.writeSnapshot(state)
    if (proposed) await this.exportDaily(state.daily)

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
    const merged: MergedPr[] = this.cache().github?.merged ?? []
    const snapshot = {
      generatedAt: state.generatedAt,
      sources: state.sources,
      queue: state.queue.map(summarize),
      active: state.active.map(summarize),
      waitingOnOthers: [
        ...state.waiting.map(summarize),
        ...state.loose.map(item => ({
          title: item.title,
          links: [item.ref],
          url: item.url,
          mine: item.mine,
          asked: item.asked?.excerpt ?? null,
        })),
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
