import { describe, expect, it } from 'vitest'
import type { Ticket } from '../src/main/engine/rank'
import { markSprint } from '../src/main/sources/jira'
import { knowsSprint, outsideSprint } from '../src/shared/sprint'
import type { Item, TopicView } from '../src/shared/types'

const item = (kind: Item['kind'], inSprint?: boolean): Item => ({
  ref: 'X',
  refs: ['X'],
  kind,
  title: '',
  url: '',
  terminal: false,
  ball: 'me',
  mine: true,
  signals: [],
  ...(inSprint === undefined ? {} : { inSprint }),
})

const view = (rank: TopicView['rank'], items: Item[]) => ({ rank, items }) as TopicView

describe('sprint en cours', () => {
  it('ne cache que les sujets faits seulement de tickets hors sprint', () => {
    expect(outsideSprint(view(6, [item('ticket', false)]))).toBe(true)
    expect(outsideSprint(view(6, [item('ticket', true)]))).toBe(false)
    expect(outsideSprint(view(6, [item('ticket', false), item('pr')]))).toBe(false)
    expect(outsideSprint(view(6, [item('ticket')]))).toBe(false)
    expect(outsideSprint(view(6, []))).toBe(false)
    expect(outsideSprint(view(3, [item('ticket', false)]))).toBe(false)
  })

  it('ne montre le choix que si Jira connaît le sprint', () => {
    expect(knowsSprint([view(6, [item('ticket')])])).toBe(false)
    expect(knowsSprint([view(6, [item('ticket', false)])])).toBe(true)
  })

  it('laisse inconnus les tickets d’un projet sans sprint', () => {
    const ticket = (key: string) => ({ key }) as Ticket
    const marked = markSprint([ticket('DEVPP-1'), ticket('DEVPP-2'), ticket('CCM-3')], new Set(['DEVPP']), new Set(['DEVPP-1']))
    expect(marked.map(entry => entry.inSprint)).toEqual([true, false, undefined])
  })
})
