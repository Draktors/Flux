// Kinds of call Flux sorts Granola notes into
export type CallType =
  | 'daily'
  | 'planning'
  | 'refinement'
  | 'review'
  | 'retro'
  | 'review-retro'
  | 'ai'
  | 'one-on-one'
  | 'other'

export const CALL_TYPES: Array<{ id: CallType; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'planning', label: 'Sprint planning' },
  { id: 'refinement', label: 'Affinage' },
  { id: 'review', label: 'Sprint review' },
  { id: 'retro', label: 'Rétro' },
  { id: 'review-retro', label: 'Review & rétro' },
  { id: 'ai', label: 'Point IA' },
  { id: 'one-on-one', label: '1:1' },
  { id: 'other', label: 'Autre' },
]

export function callTypeLabel(type: CallType): string {
  return CALL_TYPES.find(entry => entry.id === type)?.label ?? 'Autre'
}

// Where a classification came from, strongest last: you always win
export type CallSource = 'rotation' | 'claude' | 'title' | 'you'

export interface CallView {
  id: string
  title: string
  // ISO time the meeting started
  at: string
  url: string
  participants: string[]
  summary: string | null
  type: CallType
  // Workspace id (pp, cc…); null without workspaces
  workspace: string | null
  typeSource: CallSource
  workspaceSource: CallSource
  // Flux guessed and could be wrong: shown as « À vérifier »
  uncertain: boolean
}

export interface GranolaStatus {
  connected: boolean
  // Account Granola reports, once connected
  email: string | null
  // Sign-in waiting in the browser
  connecting: boolean
  error: string | null
  at: string | null
}

export interface CallsState {
  calls: CallView[]
  granola: GranolaStatus
}

export interface CallPatch {
  type?: CallType
  workspace?: string
}
