export type Rank = 0 | 1 | 2 | 3 | 4 | 5 | 6
// parked: in a Linear backlog with nothing asked of me, shown nowhere until someone asks
export type Ball = 'me' | 'others' | 'agent' | 'dormant' | 'parked'
export type TopicStatus = 'inbox' | 'open' | 'done'
export type ThreadStatus = 'busy' | 'idle' | 'closed' | 'pending'
export type SourceName = 'github' | 'linear' | 'agents' | 'calendar'

export type ActionKind =
  | 'submit-review'
  | 'take-comments'
  | 'review'
  | 're-review'
  | 'question'
  | 'ship'
  | 'fix-pr'
  | 'ticket'
  | 'diagnostic'
  | 'cadrage'
  | 'resume'
  | 'free'

export interface Signal {
  id: string
  rank: Rank
  weight: number
  detail: string
  since: string
  stamp: string
  action: ActionKind
}

export interface Item {
  ref: string
  refs: string[]
  kind: 'pr' | 'ticket'
  title: string
  url: string
  branch?: string
  terminal: boolean
  ball: 'me' | 'others' | 'dormant' | 'parked'
  // My PR or a ticket assigned to me, as opposed to someone else's I take part in
  mine: boolean
  signals: Signal[]
  // My comment on it that nobody answered yet
  asked?: AskedLine
}

export interface AskedLine {
  excerpt: string
  at: string
  url: string
}

export interface ThreadRef {
  session: string
  name: string
  cwd: string
  startedAt: string
  // Folder under ~/.flux/threads holding the brief, when it differs from the session id
  dir?: string
  // Opened in Claude Desktop, its transcript not found yet: the session id is still unknown
  pending?: boolean
  // Legacy cmux tab
  workspace?: string
  closing?: boolean
}

export interface Topic {
  id: string
  title: string
  status: TopicStatus
  links: string[]
  threads: ThreadRef[]
  blocked?: string
  createdAt: string
  closedAt?: string
  body: string
}

export interface ThreadView extends ThreadRef {
  status: ThreadStatus
}

export interface ProposedAction {
  kind: ActionKind
  label: string
  url: string
  prompt?: string
  cwd?: string
}

export interface TopicView {
  topic: Topic
  items: Item[]
  signals: Signal[]
  threads: ThreadView[]
  rank: Rank | null
  ball: Ball
  // My own work: one of its items is mine, or a note with nothing linked
  mine: boolean
  since: string | null
  actions: ProposedAction[]
}

export interface SourceProgress {
  source: SourceName
  ok: boolean
}

export interface SourceHealth {
  ok: boolean
  at: string | null
  error?: string
}

export interface Meeting {
  title: string
  start: string
  end: string
}

export type HealthLevel = 'ok' | 'weak' | 'alert' | 'positive' | 'unavailable'

// One figure behind a health line: an event and its users, a monitor and its state
export interface HealthItem {
  label: string
  value: string
}

export interface HealthLine {
  source: string
  level: HealthLevel
  text: string
  // Shown only when the line is an alert
  detail: string | null
  url: string | null
  // Absent from the dailies written before lines had figures
  items?: HealthItem[]
}

export type Store = 'app-store' | 'play-store'

export interface StoreReview {
  id: string
  app: string
  store: Store
  rating: number
  title: string | null
  text: string
  author: string
  date: string
  version: string | null
  url: string
}

// What the stores said, and the app and store pairs that did not answer
export interface StoreFeed {
  reviews: StoreReview[]
  failed: Array<{ app: string; store: Store }>
}

// What the daily skill wrote, once Flux checked it
export interface DailyContent {
  generatedAt: string
  intentions: string[]
  // Short titles and unblocking moves, by line id
  titles: Record<string, string>
  unblock: Record<string, string>
  health: HealthLine[]
}

// The run that asks the skill for the generated part of the daily
export interface DailyRun {
  date: string
  status: 'none' | 'running' | 'ready' | 'error'
  error?: string
  content?: DailyContent
}

export interface RefPill {
  ref: string
  url: string | null
}

interface DailyLine {
  // Topic id, or merged:<ref> for a PR no topic holds
  id: string
  topicId: string | null
  live: boolean
  title: string
  // The skill's short title, eight words at most
  short: string | null
  refs: RefPill[]
  url: string | null
}

export type YesterdayKind =
  | 'merged'
  | 'reviewed'
  | 'feedback'
  | 'submitted'
  | 'answered'
  | 'handled'
  | 'closed'
  | 'ticked'

export interface DailyYesterday extends DailyLine {
  kind: YesterdayKind
  at: string
}

export interface DailyIntention extends DailyLine {
  rank: Rank | null
  detail: string | null
  // Done since the morning: the wrap-up moves on to the queue
  done: boolean
}

export interface DailyBlocker extends DailyLine {
  reason: string
  unblock: string | null
}

export interface RankCount {
  rank: Rank
  count: number
  firstId: string
}

export interface DailySheet {
  date: string
  status: DailyRun['status']
  error?: string
  skill: 'missing' | 'ready'
  dailyTime: string
  generatedAt: string | null
  notePath: string | null
  // First day the yesterday block covers: the previous workday
  since: string
  yesterday: DailyYesterday[]
  intentions: DailyIntention[]
  intentionsEdited: boolean
  // What an intention can be picked from: the head of the queue and the work in progress
  candidates: DailyIntention[]
  blockers: DailyBlocker[]
  health: HealthLine[] | null
  // Reviews posted since the previous workday; null when no app is followed
  reviews: StoreFeed | null
  counts: RankCount[]
}

export interface MergedPr {
  ref: string
  title: string
  url: string
  mergedAt: string
}

// How a task of the day got done: merged, closed in Flux, its ask left the queue, or ticked by hand
export type WrapupOutcome = 'merged' | 'closed' | 'handled' | 'ticked'

interface WrapupLine {
  id: string
  // Null for a merged PR no topic holds
  topicId: string | null
  // Still open in Flux, so the line can select it
  live: boolean
  ref: string | null
  title: string
  detail: string | null
  url: string | null
}

export interface WrapupDone extends WrapupLine {
  outcome: WrapupOutcome
  at: string
  // Settled by the source itself, a merge or an ask that left: the box stays ticked
  locked: boolean
}

export interface WrapupFocus extends WrapupLine {
  rank: Rank | null
  since: string | null
}

export interface WrapupView {
  date: string
  // Latest reminder time reached today, and the one after it
  slot: string | null
  next: string | null
  done: WrapupDone[]
  focus: WrapupFocus[]
}

export interface AppState {
  generatedAt: string
  queue: TopicView[]
  active: TopicView[]
  waiting: TopicView[]
  dormant: TopicView[]
  notes: TopicView[]
  loose: Item[]
  sources: Record<SourceName, SourceHealth>
  meeting: { current: Meeting | null; next: Meeting | null }
  daily: DailySheet
  wrapup: WrapupView
}

export interface Settings {
  dailyTime: string
  wrapupTimes: string[]
  captureShortcut: string
  workdayStart: number
  workdayEnd: number
  hasLinearKey: boolean
  hasCalendarUrl: boolean
  onboarded: boolean
}

export interface SettingsPatch {
  dailyTime?: string
  wrapupTimes?: string[]
  captureShortcut?: string
  linearKey?: string
  calendarUrl?: string
  onboarded?: boolean
}

export interface CheckResult {
  ok: boolean
  detail: string
}

// The macOS permission for Flux notifications; unsupported when it cannot be read
export type NotificationAccess =
  | 'not-determined'
  | 'denied'
  | 'authorized'
  | 'provisional'
  | 'unsupported'

export interface FluxApi {
  getState(): Promise<AppState>
  onState(listener: (state: AppState) => void): () => void
  // Refetches every source now and resolves once the new state is out
  refreshAll(): Promise<void>
  onProgress(listener: (progress: SourceProgress) => void): () => void
  onOpenTopic(listener: (id: string) => void): () => void
  onOpenDaily(listener: () => void): () => void
  onOpenWrapup(listener: () => void): () => void
  // Ticks or unticks a wrap-up line: a free task closes, a closed topic reopens
  checkWrapup(id: string, done: boolean): Promise<void>
  refresh(): Promise<void>
  createNote(text: string): Promise<void>
  openCapture(): Promise<void>
  closeCapture(): Promise<void>
  updateTopic(
    id: string,
    patch: Partial<Pick<Topic, 'title' | 'body' | 'status' | 'blocked' | 'links'>>,
  ): Promise<void>
  closeTopic(id: string): Promise<void>
  launchThread(id: string, action: ProposedAction): Promise<void>
  focusThread(id: string, session: string): Promise<void>
  openExternal(url: string): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(patch: SettingsPatch): Promise<void>
  testNotification(): Promise<void>
  openNotificationSettings(): Promise<void>
  notificationAccess(): Promise<NotificationAccess>
  requestNotificationAccess(): Promise<NotificationAccess>
  checkGithub(): Promise<CheckResult>
  checkLinearKey(key: string): Promise<CheckResult>
  checkCalendarUrl(url: string): Promise<CheckResult>
  runDaily(): Promise<void>
  openDaily(): Promise<void>
  // Today's intentions, in order; the wrap-up puts them first in its focus
  setIntentions(ids: string[]): Promise<void>
  // Writes the generic daily skill where the config expects it, never over an existing file
  useDailyTemplate(): Promise<CheckResult>
  // Opens a Claude Desktop session that writes the daily skill with the user
  createDailySkill(): Promise<void>
}
