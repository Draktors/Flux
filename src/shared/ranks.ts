import type { Rank } from './types'

export const RANKS: Record<Rank, { label: string; notify: boolean }> = {
  0: { label: 'À soumettre', notify: true },
  1: { label: 'Retours sur mes PR', notify: true },
  2: { label: 'Reviews', notify: true },
  3: { label: 'Questions', notify: true },
  4: { label: 'Prêt à livrer', notify: false },
  5: { label: 'Agents', notify: false },
  6: { label: 'Mes sujets', notify: false },
}
