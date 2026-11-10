import type { CallPatch, CallsState } from './calls'
import type { CalendarName } from './calendars'
import type { TrackerName } from './trackers'

export type Rank = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type Ball = 'me' | 'others' | 'agent' | 'dormant'
export type TopicStatus = 'inbox' | 'open' | 'done'
export type ThreadStatus = 'busy' | 'idle' | 'closed' | 'pending'
export type SourceName = 'github' | 'linear' | 'jira' | 'agents' | 'calendar'

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
  // Not configured yet: the only case that asks you to connect it
  missing?: boolean
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

export interface WorkspaceInfo {
  id: string
  label: string
  short: string
}

export interface AppState {
  generatedAt: string
  // Product Flux currently shows; null when no workspace is configured
  workspace: string | null
  workspaces: WorkspaceInfo[]
  queue: TopicView[]
  active: TopicView[]
  waiting: TopicView[]
  dormant: TopicView[]
  notes: TopicView[]
  loose: Item[]
  // Only the sources in use: a tool you did not choose never asks to be connected
  sources: Partial<Record<SourceName, SourceHealth>>
  meeting: { current: Meeting | null; next: Meeting | null }
  daily: DailyState
}

// A Jira project or Linear team you follow: each one becomes a workspace you switch to
export interface TrackedProject {
  tracker: TrackerName
  // Project or team key, e.g. DEVPP or APP
  key: string
  name: string
  // GitHub repos (owner/name) whose PRs belong to this project
  repos: string[]
  // Subset of repos where your PRs merge without a review
  noReview: string[]
}

export interface ProjectOption {
  tracker: TrackerName
  key: string
  name: string
}

export interface ProjectOptions {
  projects: ProjectOption[]
  // Repos you recently had PRs in, owner/name
  repos: string[]
  // One line per tool that could not be listed
  errors: string[]
}

export interface Settings {
  dailyTime: string
  captureShortcut: string
  workdayStart: number
  workdayEnd: number
  hasLinearKey: boolean
  hasCalendarUrl: boolean
  hasJiraToken: boolean
  jiraEmail: string
  // Atlassian site, e.g. https://acme.atlassian.net; empty when not configured
  jiraSite: string
  // Project tools you chose, in the order you added them
  trackers: TrackerName[]
  // Calendar whose iCal link Flux reads; null when you use none
  calendar: CalendarName | null
  onboarded: boolean
  // gh login Flux reads GitHub as; null follows gh's active account
  githubAccount: string | null
  workspace: string | null
  // null until chosen in the app: the workspaces of config.json apply
  projects: TrackedProject[] | null
}

export interface SettingsPatch {
  dailyTime?: string
  captureShortcut?: string
  linearKey?: string
  calendarUrl?: string
  jiraEmail?: string
  jiraToken?: string
  jiraSite?: string
  trackers?: TrackerName[]
  calendar?: CalendarName | 'none'
  workspace?: string
  onboarded?: boolean
  githubAccount?: string | null
  projects?: TrackedProject[]
}

export interface GithubAccounts {
  host: string
  // Logins gh is signed in with on that host, gh's active one first
  logins: string[]
  active: string | null
  profiles: Record<string, GithubProfile>
}

export interface GithubProfile {
  name: string | null
  // Data URL, so the renderer never loads remote images
  avatar: string | null
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
  onRefreshShortcut(listener: () => void): () => void
  getCalls(): Promise<CallsState>
  onCalls(listener: (state: CallsState) => void): () => void
  updateCall(id: string, patch: CallPatch): Promise<void>
  syncCalls(): Promise<void>
  connectGranola(): Promise<void>
  disconnectGranola(): Promise<void>
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
  githubAccounts(): Promise<GithubAccounts>
  checkLinearKey(key: string): Promise<CheckResult>
  checkJira(site: string, email: string, token: string): Promise<CheckResult>
  listProjects(): Promise<ProjectOptions>
  checkCalendarUrl(url: string): Promise<CheckResult>
  runDaily(): Promise<void>
  readDaily(): Promise<string | null>
  openDaily(): Promise<void>
}
