import { describe, expect, it } from 'vitest'
import {
  buildWrapup,
  dueSlot,
  emptyJournal,
  isFreeTask,
  normalizeTimes,
  observe,
  tick,
  wrapupNotification,
  type WrapupInput,
  type WrapupJournal,
} from '../src/main/engine/wrapup'
import type { MergedPr, Rank, Signal, Topic, TopicView } from '../src/shared/types'

// Local times, whatever the machine's zone: the wrap-up follows the wall clock
const at = (hours: number, minutes = 0, day = 10) => new Date(2026, 10, day, hours, minutes)
const TIMES = ['11:00', '14:30', '16:30']
const healthy = () => true

function topic(id: string, overrides: Partial<Topic> = {}): Topic {
  return {
    id,
    title: `${id} — Sujet ${id}`,
    status: 'open',
    links: [id],
    threads: [],
    createdAt: at(8).toISOString(),
    body: '',
    ...overrides,
  }
}

function signal(ref: string, suffix: string, rank: Rank, stamp: Date, detail = `${suffix} sur ${ref}`): Signal {
  const iso = stamp.toISOString()
  return { id: `${ref}:${suffix}`, rank, weight: 0, detail, since: iso, stamp: iso, action: 'review' }
}

function view(subject: Topic, signals: Signal[]): TopicView {
  return {
    topic: subject,
    items: [],
    signals,
    threads: [],
    rank: signals[0]?.rank ?? null,
    ball: signals.length > 0 ? 'me' : 'others',
    mine: true,
    since: signals[0]?.since ?? null,
    actions: [],
  }
}

function input(overrides: Partial<WrapupInput>): WrapupInput {
  return {
    journal: emptyJournal('2026-11-10'),
    topics: [],
    views: [],
    queue: [],
    merged: [],
    times: TIMES,
    now: at(11, 5),
    ...overrides,
  }
}

describe('journal du wrap-up', () => {
  const review = topic('hb#7001')
  const ask = signal('hb#7001', 'review', 2, at(9), 'Review demandée par nicolas')

  it('compte comme traitée une demande qui quitte le flux', () => {
    const morning = observe(emptyJournal(''), [view(review, [ask])], at(9, 30), healthy)
    const later = observe(morning, [view(review, [])], at(10, 42), healthy)
    expect(later.handled['hb#7001:review']).toMatchObject({
      topicId: 'hb#7001',
      detail: 'Review demandée par nicolas',
      at: at(10, 42).toISOString(),
    })
    expect(later.open).toEqual({})
  })

  it('ne conclut rien quand la source est en panne', () => {
    const morning = observe(emptyJournal(''), [view(review, [ask])], at(9, 30), healthy)
    const later = observe(morning, [], at(10, 42), source => source !== 'github')
    expect(later.handled).toEqual({})
    expect(later.open['hb#7001:review']).toBeDefined()
  })

  it('efface un aller-retour sans nouveauté, garde un second tour', () => {
    const morning = observe(emptyJournal(''), [view(review, [ask])], at(9, 30), healthy)
    const gone = observe(morning, [view(review, [])], at(10), healthy)
    const blip = observe(gone, [view(review, [ask])], at(10, 1), healthy)
    expect(blip.handled).toEqual({})

    const again = signal('hb#7001', 'review', 2, at(10, 30))
    const second = observe(gone, [view(review, [again])], at(10, 31), healthy)
    expect(second.handled['hb#7001:review']).toBeDefined()
  })

  it('ignore les threads et les tâches libres', () => {
    const free = topic('note', { links: [] })
    const task = { ...signal('task', 'note', 6, at(8)), id: 'task:note' }
    const morning = observe(emptyJournal(''), [view(free, [task])], at(9), healthy)
    expect(morning.open).toEqual({})
  })

  it('repart de zéro chaque jour', () => {
    const yesterday = observe(emptyJournal(''), [view(review, [ask])], at(17, 0, 9), healthy)
    const today = observe(yesterday, [], at(9), healthy)
    expect(today.date).toBe('2026-11-10')
    expect(today.handled).toEqual({})
  })
})

describe('liste du wrap-up', () => {
  const merged: MergedPr[] = [
    { ref: 'daca#1596', title: 'feat: panneau vocal', url: 'https://example.test/1596', mergedAt: at(10, 46).toISOString() },
    { ref: 'aura#220', title: 'chore: Screeb', url: 'https://example.test/220', mergedAt: at(9, 15).toISOString() },
    { ref: 'aura#219', title: 'chore: hier', url: 'https://example.test/219', mergedAt: at(16, 0, 9).toISOString() },
  ]

  it('rattache une PR mergée à son sujet et garde les autres à part', () => {
    const shipped = topic('daca#1596', { status: 'done', closedAt: at(10, 47).toISOString() })
    const wrapup = buildWrapup(input({ topics: [shipped], merged }))
    expect(wrapup.done.map(line => [line.id, line.outcome, line.locked])).toEqual([
      ['merged:aura#220', 'merged', true],
      ['daca#1596', 'merged', true],
    ])
  })

  it('laisse décocher un sujet clos à la main, pas une demande traitée', () => {
    const closed = topic('note', { links: [], status: 'done', closedAt: at(10).toISOString() })
    const reviewed = topic('hb#7001')
    const journal: WrapupJournal = {
      ...emptyJournal('2026-11-10'),
      handled: {
        'hb#7001:review': { topicId: 'hb#7001', detail: 'Review demandée par nicolas', rank: 2, stamp: at(9).toISOString(), at: at(10, 42).toISOString() },
      },
    }
    const wrapup = buildWrapup(input({ journal, topics: [closed, reviewed], views: [view(reviewed, [])] }))
    expect(wrapup.done).toMatchObject([
      { id: 'note', outcome: 'closed', locked: false, live: false },
      { id: 'hb#7001', outcome: 'handled', locked: true, live: true, detail: 'Review demandée par nicolas' },
    ])
  })

  it('propose la tête de file sans ce qui vient d’être coché', () => {
    const views = ['a#1', 'b#2', 'c#3', 'd#4'].map((ref, index) =>
      view(topic(ref), [signal(ref, 'feedback', 1, at(8, index))]),
    )
    const journal = tick(emptyJournal('2026-11-10'), 'a#1', at(10))
    const wrapup = buildWrapup(input({ journal, topics: views.map(entry => entry.topic), views, queue: views }))
    expect(wrapup.focus.map(line => line.id)).toEqual(['b#2', 'c#3', 'd#4'])
    expect(wrapup.done).toMatchObject([{ id: 'a#1', outcome: 'ticked', locked: false }])
  })

  it('repropose un sujet coché quand du neuf arrive', () => {
    const fresh = view(topic('a#1'), [signal('a#1', 'feedback', 1, at(10, 30))])
    const journal = tick(emptyJournal('2026-11-10'), 'a#1', at(10))
    const wrapup = buildWrapup(input({ journal, topics: [fresh.topic], views: [fresh], queue: [fresh] }))
    expect(wrapup.focus.map(line => line.id)).toEqual(['a#1'])
  })

  it('situe le point courant et le suivant', () => {
    expect(buildWrapup(input({ now: at(9) }))).toMatchObject({ slot: null, next: '11:00' })
    expect(buildWrapup(input({ now: at(15) }))).toMatchObject({ slot: '14:30', next: '16:30' })
    expect(buildWrapup(input({ now: at(17) }))).toMatchObject({ slot: '16:30', next: null })
  })
})

describe('relances', () => {
  const journal = emptyJournal('2026-11-10')

  it('relance au créneau atteint, une seule fois', () => {
    expect(dueSlot(TIMES, journal, at(10, 59), null).notify).toBeNull()
    const due = dueSlot(TIMES, journal, at(11, 0), null)
    expect(due).toEqual({ notify: '11:00', fired: ['11:00'] })
    expect(dueSlot(TIMES, { ...journal, fired: due.fired }, at(11, 1), null).notify).toBeNull()
  })

  it('attend la fin d’une réunion', () => {
    const meeting = { title: 'Rétro', start: at(10, 30).toISOString(), end: at(11, 30).toISOString() }
    expect(dueSlot(TIMES, journal, at(11, 10), meeting)).toEqual({ notify: null, fired: [] })
    expect(dueSlot(TIMES, journal, at(11, 31), null).notify).toBe('11:00')
  })

  it('laisse tomber un créneau trop ancien et ne relance que le dernier', () => {
    expect(dueSlot(TIMES, journal, at(13), null)).toEqual({ notify: null, fired: ['11:00'] })
    expect(dueSlot(TIMES, journal, at(14, 40), null).notify).toBe('14:30')
  })

  it('se tait le week-end', () => {
    expect(dueSlot(TIMES, journal, at(11, 0, 14), null).notify).toBeNull()
  })

  it('range les heures réglées', () => {
    expect(normalizeTimes(['16:30', '11:00', '11:00', '25:00', '', 'midi'])).toEqual(['11:00', '16:30'])
    expect(normalizeTimes(undefined)).toEqual(TIMES)
  })

  it('résume le point dans la notification', () => {
    const lead = view(topic('daca#1516'), [signal('daca#1516', 'feedback', 1, at(8), '14 retours de paul')])
    const wrapup = buildWrapup(input({ topics: [lead.topic], views: [lead], queue: [lead] }))
    expect(wrapupNotification(wrapup, '11:00')).toEqual({
      title: 'Wrap-up de 11:00',
      body: 'Rien de bouclé pour l’instant · focus : daca#1516, 14 retours de paul',
    })
  })

  it('distingue une tâche libre d’un sujet suivi', () => {
    expect(isFreeTask(topic('note', { links: [] }))).toBe(true)
    expect(isFreeTask(topic('note', { links: ['https://example.test'] }))).toBe(true)
    expect(isFreeTask(topic('OFF-917'))).toBe(false)
  })
})
