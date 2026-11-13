import type { TrackerName } from './trackers'

// What a ticket's status means for you, whatever the tool calls it
export type StatusRole = 'question' | 'ready' | 'mine' | 'todo' | 'handedOff' | 'parked' | 'done'

// Overrides chosen in the settings, by project and status name (see statusKey)
export type StatusRules = Partial<Record<string, StatusRole>>

export const STATUS_ROLES: Array<{ role: StatusRole; label: string; hint: string }> = [
  { role: 'question', label: 'Question pour moi', hint: 'Attend ta réponse ou ton cadrage : en haut de la file' },
  { role: 'ready', label: 'Prêt à déployer', hint: 'À livrer : dans ta file' },
  { role: 'mine', label: 'En cours chez moi', hint: 'Tu travailles dessus : dans ta file' },
  { role: 'todo', label: 'À faire', hint: 'Assigné, pas commencé : dans ta file, après le reste' },
  { role: 'handedOff', label: 'Chez les autres', hint: 'Review, test, recette : en Attente' },
  { role: 'parked', label: 'En réserve', hint: 'Backlog : ne revient que sur une demande' },
  { role: 'done', label: 'Terminé', hint: 'Le sujet se ferme' },
]

export const STATUS_ROLE_LABEL = Object.fromEntries(
  STATUS_ROLES.map(({ role, label }) => [role, label]),
) as Record<StatusRole, string>

// One status of a tool, as the settings list it
export interface TrackerStatus {
  tracker: TrackerName
  name: string
  // Jira's category or Linear's type, mapped to Linear's words: backlog, unstarted, started, completed…
  type: string
  // Projects or teams it shows up in
  projects: string[]
}

// The statuses of one workspace, in board order
export interface StatusGroup {
  id: string
  label: string
  statuses: TrackerStatus[]
}

export interface StatusOptions {
  groups: StatusGroup[]
  // One line per tool that could not be listed
  errors: string[]
}

export const CLOSED_STATE_TYPES = new Set(['completed', 'canceled', 'duplicate'])
// Names Flux knows without any setting; everything else falls back on the status type
const QUESTION_STATES = new Set(['to unblock', 'to frame', 'technical review'])
const OWN_STATES = new Set(['todo today', 'in progress', 'personal review'])
const READY = /^ready to (deploy|mep)$/i
// Jira in-progress statuses that wait on a reviewer or a tester rather than on you, « Dev Done » included
const HANDED_OFF = /review|revue|test|recette|qa|valid|merge|deploy|mep|livr|done|termin|fini/i

const nameKey = (name: string) => name.trim().toLowerCase()

// A rule is set for one project (PP:dev done); without a project it holds everywhere
export function statusKey(name: string, project?: string): string {
  return project ? `${project.toUpperCase()}:${nameKey(name)}` : nameKey(name)
}

// Tickets are named after their project or team: PP-12, CCM-7
export function projectOfKey(key: string): string {
  return key.split('-')[0].toUpperCase()
}

// Linear names its in-progress states one by one; Jira only says « in progress », so a name decides
export function defaultRole(tracker: TrackerName, name: string, type: string): StatusRole {
  const key = nameKey(name)
  if (CLOSED_STATE_TYPES.has(type)) return 'done'
  if (QUESTION_STATES.has(key)) return 'question'
  if (READY.test(key)) return 'ready'
  if (OWN_STATES.has(key)) return 'mine'
  if (type === 'started') return tracker === 'jira' && !HANDED_OFF.test(name) ? 'mine' : 'handedOff'
  if (type === 'unstarted') return 'todo'
  if (type === 'backlog') return 'parked'
  return 'handedOff'
}

export function roleOf(
  tracker: TrackerName,
  name: string,
  type: string,
  rules: StatusRules | undefined,
  project?: string,
): StatusRole {
  const own = project ? rules?.[statusKey(name, project)] : undefined
  return own ?? rules?.[statusKey(name)] ?? defaultRole(tracker, name, type)
}
