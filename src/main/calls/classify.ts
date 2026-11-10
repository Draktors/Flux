import type { CallSource, CallType } from '../../shared/calls'
import type { FluxConfig, Workspace } from '../config'

const DAY_MS = 86_400_000

export interface Guess<T> {
  value: T
  source: CallSource
}

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

// Most specific first: « Sprint Review & Retro » is both, before either alone
const TYPE_RULES: Array<[CallType, RegExp]> = [
  ['review-retro', /\breview\b.*\bretro|\bretro.*\breview\b/],
  ['daily', /\bdaily\b|stand ?up|\bmeteo\b/],
  ['planning', /\bplanning\b|\bplanif/],
  ['refinement', /\baffinage\b|refinement|grooming|\bbacklog\b/],
  ['retro', /\bretro/],
  ['review', /\bsprint review\b|\breview\b|\bdemo\b/],
  ['one-on-one', /\b1 ?:\s?1\b|one.?on.?one|\bpoint individuel\b|\bentretien\b/],
  ['ai', /\b(ia|ai|llm|claude|copilot|chatgpt|mcp)\b|intelligence artificielle/],
]

export function typeFromTitle(title: string): CallType | null {
  const text = plain(title)
  return TYPE_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? null
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordsOf(workspace: Workspace): string[] {
  return [
    workspace.short ?? '',
    workspace.label,
    ...workspace.jiraProjects,
    ...(workspace.keywords ?? []),
  ]
    .map(word => plain(word).trim())
    .filter(word => word.length >= 2)
}

// The workspace a text names, when exactly one of them is named
export function workspaceFromText(text: string, workspaces: Workspace[]): string | null {
  const haystack = plain(text)
  const named = workspaces.filter(workspace =>
    wordsOf(workspace).some(word =>
      new RegExp(`(^|[^a-z0-9])${escape(word)}($|[^a-z0-9])`).test(haystack),
    ),
  )
  return named.length === 1 ? named[0].id : null
}

// Monday 00:00 local time of the week holding date
function monday(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  return day
}

export function rotationWorkspace(
  rotation: FluxConfig['rotation'],
  at: Date,
): string | null {
  if (!rotation) return null
  const [year, month, day] = rotation.start.split('-').map(Number)
  const start = monday(new Date(year, month - 1, day))
  const weeks = Math.round((monday(at).getTime() - start.getTime()) / (7 * DAY_MS))
  const slot = Math.floor(weeks / rotation.weeks)
  const count = rotation.order.length
  return rotation.order[((slot % count) + count) % count]
}

export interface Classification {
  type: Guess<CallType>
  workspace: Guess<string | null>
}

// Rules only: what Flux can tell from the title and the summary without asking Claude
export function classifyByRules(
  call: { title: string; summary: string | null; at: string },
  config: Pick<FluxConfig, 'workspaces' | 'rotation'>,
): Classification {
  const titled = typeFromTitle(call.title)
  // Only the title counts: a summary names people and partners (« Fabien (Citopia) ») of either product
  const named = workspaceFromText(call.title, config.workspaces)
  const fallback = rotationWorkspace(config.rotation, new Date(call.at)) ?? config.workspaces[0]?.id ?? null
  return {
    type: titled ? { value: titled, source: 'title' } : { value: 'other', source: 'rotation' },
    workspace: named ? { value: named, source: 'title' } : { value: fallback, source: 'rotation' },
  }
}

// Rules settled both: no need to ask Claude
export function settled(classification: Classification, workspaces: Workspace[]): boolean {
  return (
    classification.type.source !== 'rotation' &&
    (workspaces.length < 2 || classification.workspace.source !== 'rotation')
  )
}
