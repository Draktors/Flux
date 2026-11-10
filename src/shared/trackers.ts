// Project management tools Flux can read tickets from
export type TrackerName = 'jira' | 'linear' | 'trello' | 'notion'

export interface TrackerInfo {
  id: TrackerName
  label: string
  // Not wired to a source yet: listed so the choice is visible, but cannot be added
  soon?: boolean
}

export const TRACKERS: TrackerInfo[] = [
  { id: 'jira', label: 'Jira' },
  { id: 'linear', label: 'Linear' },
  { id: 'trello', label: 'Trello', soon: true },
  { id: 'notion', label: 'Notion', soon: true },
]

export const AVAILABLE_TRACKERS = TRACKERS.filter(tracker => !tracker.soon).map(tracker => tracker.id)
