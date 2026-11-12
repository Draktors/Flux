import type { TopicView } from './types'

// A « Mes sujets » card made only of tickets outside the running sprint: a PR, a free task
// or a ticket whose project runs no sprint always stays
export function outsideSprint(view: TopicView): boolean {
  if (view.rank !== 6 || view.items.length === 0) return false
  return view.items.every(item => item.kind === 'ticket' && item.inSprint === false)
}

// The switch only makes sense once Flux knows which tickets are in a sprint
export function knowsSprint(views: TopicView[]): boolean {
  return views.some(view => view.items.some(item => item.inSprint !== undefined))
}
