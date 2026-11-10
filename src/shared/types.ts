export type Rank = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type Ball = 'me' | 'others' | 'agent' | 'dormant'
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
  ball: 'me' | 'others' | 'dormant'
  signals: Signal[]
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

export interface DailyState {
  date: string
  status: 'none' | 'running' | 'ready' | 'error'
  path?: string
  error?: string
}

export interface MergedPr {
  ref: string
  title: string
  url: string
  mergedAt: string
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
  daily: DailyState
}

export interface Settings {
  dailyTime: string
  captureShortcut: string
  workdayStart: number
  workdayEnd: number
  hasLinearKey: boolean
  hasCalendarUrl: boolean
  onboarded: boolean
}

export interface SettingsPatch {
  dailyTime?: string
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
  onProgress(listener: (progress: SourceProgress) => void): () => void
  onOpenTopic(listener: (id: string) => void): () => void
  onOpenDaily(listener: () => void): () => void
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
  readDaily(): Promise<string | null>
  openDaily(): Promise<void>
}
