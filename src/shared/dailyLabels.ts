import type { HealthLevel, Rank, Store, YesterdayKind } from './types'

export const YESTERDAY_LABEL: Record<YesterdayKind, string> = {
  merged: 'Mergée',
  reviewed: 'Review rendue',
  feedback: 'Retours traités',
  submitted: 'Commentaires soumis',
  answered: 'Question répondue',
  handled: 'Traité',
  closed: 'Clos',
  ticked: 'Coché',
  pushed: 'Poussé',
  wip: 'En cours',
  meeting: 'Réunion',
}

// One and many, as the footer counts read: « 1 à soumettre · 3 retours · 6 reviews »
const COUNT_LABEL: Record<Rank, [string, string]> = {
  0: ['à soumettre', 'à soumettre'],
  1: ['retour', 'retours'],
  2: ['review', 'reviews'],
  3: ['question', 'questions'],
  4: ['prête à livrer', 'prêtes à livrer'],
  5: ['agent', 'agents'],
  6: ['mon sujet', 'mes sujets'],
}

export function countLabel(rank: Rank, count: number): string {
  return `${count} ${COUNT_LABEL[rank][count > 1 ? 1 : 0]}`
}

export const HEALTH_LEVELS: HealthLevel[] = ['ok', 'weak', 'alert', 'positive', 'unavailable']

export const STORE_LABEL: Record<Store, string> = {
  'app-store': 'App Store',
  'play-store': 'Google Play',
}

export function stars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating)
}
