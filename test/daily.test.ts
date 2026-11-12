import { describe, expect, it } from 'vitest'
import {
  buildDaily,
  newReviews,
  previousWorkday,
  rankCounts,
  renderDailyNote,
  windowDays,
  yesterdayKind,
  type DailyInput,
} from '../src/main/engine/daily'
import { buildWrapup, emptyJournal, tick, type WrapupJournal } from '../src/main/engine/wrapup'
import type { Rank, Signal, StoreReview, Topic, TopicView } from '../src/shared/types'

// Local times: the daily follows the wall clock. 6 Nov 2026 is a Friday, 9 Nov a Monday
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes)

function topic(id: string, overrides: Partial<Topic> = {}): Topic {
  return {
    id,
    title: `${id} — Sujet ${id}`,
    status: 'open',
    links: [id],
    threads: [],
    createdAt: at(6, 8).toISOString(),
    body: '',
    ...overrides,
  }
}

function signal(ref: string, rank: Rank, stamp: Date): Signal {
  const iso = stamp.toISOString()
  return { id: `${ref}:ask`, rank, weight: 0, detail: `Demande sur ${ref}`, since: iso, stamp: iso, action: 'review' }
}

function view(subject: Topic, signals: Signal[], ball: TopicView['ball'] = 'me'): TopicView {
  return {
    topic: subject,
    items: [{ ref: subject.links[0], url: `https://example.test/${subject.id}` } as TopicView['items'][number]],
    signals,
    threads: [],
    rank: signals[0]?.rank ?? null,
    ball: signals.length > 0 ? ball : 'others',
    since: signals[0]?.since ?? null,
    actions: [],
  }
}

function journal(date: string, overrides: Partial<WrapupJournal> = {}): WrapupJournal {
  return { ...emptyJournal(date), ...overrides }
}

function input(overrides: Partial<DailyInput>): DailyInput {
  const now = overrides.now ?? at(10, 9, 30)
  const today = overrides.today ?? journal('2026-11-10')
  return {
    now,
    journals: [today],
    today,
    topics: [],
    views: [],
    queue: [],
    active: [],
    merged: [],
    fallback: null,
    reviews: null,
    run: { date: '2026-11-10', status: 'none' },
    skill: 'ready',
    dailyTime: '09:30',
    notePath: null,
    ...overrides,
  }
}

describe('fenêtre du daily', () => {
  it('lit vendredi un lundi, week-end et matinée compris', () => {
    expect(previousWorkday(at(9, 9))).toEqual(at(6, 0))
    expect(windowDays(at(9, 9))).toEqual(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'])
  })

  it('lit la veille en semaine', () => {
    expect(windowDays(at(10, 9))).toEqual(['2026-11-09', '2026-11-10'])
  })
})

describe('Hier', () => {
  it('nomme ce qui a été fait selon la demande traitée', () => {
    expect(yesterdayKind({ outcome: 'merged', askRank: 2 })).toBe('merged')
    expect(yesterdayKind({ outcome: 'handled', askRank: 0 })).toBe('submitted')
    expect(yesterdayKind({ outcome: 'handled', askRank: 1 })).toBe('feedback')
    expect(yesterdayKind({ outcome: 'closed', askRank: 2 })).toBe('reviewed')
    expect(yesterdayKind({ outcome: 'handled', askRank: 3 })).toBe('answered')
    expect(yesterdayKind({ outcome: 'closed', askRank: null })).toBe('closed')
    expect(yesterdayKind({ outcome: 'ticked', askRank: null })).toBe('ticked')
  })

  it('reprend les journaux de la fenêtre, sans ce qui précède la veille ouvrée', () => {
    const review = topic('hb#1')
    const old = topic('hb#2')
    const monday = journal('2026-11-09', {
      handled: {
        'hb#1:ask': { topicId: 'hb#1', detail: 'Review', rank: 2, stamp: at(9, 8).toISOString(), at: at(9, 15).toISOString() },
      },
    })
    const friday = journal('2026-11-06', {
      handled: {
        'hb#2:ask': { topicId: 'hb#2', detail: 'Review', rank: 2, stamp: at(6, 8).toISOString(), at: at(6, 15).toISOString() },
      },
    })
    const sheet = buildDaily(
      input({ journals: [friday, monday, journal('2026-11-10')], topics: [review, old], views: [view(review, [])] }),
    )
    expect(sheet.since).toBe('2026-11-09')
    expect(sheet.yesterday).toMatchObject([{ id: 'hb#1', kind: 'reviewed', refs: [{ ref: 'hb#1' }] }])
  })

  it('complète une veille sans journal par les reviews rendues', () => {
    const sheet = buildDaily(
      input({
        fallback: {
          reviewed: [{ ref: 'web#9', title: 'Écran', url: 'https://example.test/web9', reviewedAt: at(9, 16).toISOString() }],
          completed: [],
        },
      }),
    )
    expect(sheet.yesterday).toMatchObject([
      { id: 'reviewed:web#9', kind: 'reviewed', refs: [{ ref: 'web#9', url: 'https://example.test/web9' }] },
    ])
  })
})

describe('intentions', () => {
  const first = topic('hb#1')
  const second = topic('hb#2')
  const third = topic('hb#3')
  const fourth = topic('hb#4')
  const views = [first, second, third, fourth].map((entry, index) => view(entry, [signal(entry.id, 2, at(10, 8, index))]))

  it('prend la tête de file tant que le daily n’a rien proposé', () => {
    const sheet = buildDaily(input({ topics: [first, second, third, fourth], views, queue: views }))
    expect(sheet.intentions.map(line => line.id)).toEqual(['hb#1', 'hb#2', 'hb#3'])
    expect(sheet.candidates.map(line => line.id)).toEqual(['hb#4'])
  })

  it('suit l’ordre du journal et marque fait un sujet sorti de mes mains', () => {
    const today = journal('2026-11-10', { intentions: ['hb#4', 'hb#2'] })
    const done = view(second, [], 'others')
    const sheet = buildDaily(
      input({ today, journals: [today], topics: [first, second, third, fourth], views: [views[0], done, views[2], views[3]], queue: views }),
    )
    expect(sheet.intentions.map(line => [line.id, line.done])).toEqual([
      ['hb#4', false],
      ['hb#2', true],
    ])
  })

  it('met les intentions en tête du focus du wrap-up, puis la file', () => {
    const today = journal('2026-11-10', { intentions: ['hb#4', 'hb#2'] })
    const wrapup = buildWrapup({
      journal: tick(today, 'hb#2', at(10, 11)),
      topics: [first, second, third, fourth],
      views,
      queue: views,
      merged: [],
      times: ['11:00'],
      now: at(10, 11, 30),
    })
    expect(wrapup.focus.map(line => line.id)).toEqual(['hb#4', 'hb#1', 'hb#3'])
  })
})

describe('compte de la file', () => {
  it('ne garde que les rangs présents, avec le premier sujet de chacun', () => {
    const review = view(topic('hb#1'), [signal('hb#1', 2, at(10, 8))])
    const other = view(topic('hb#2'), [signal('hb#2', 2, at(10, 8))])
    const feedback = view(topic('hb#3'), [signal('hb#3', 1, at(10, 8))])
    expect(rankCounts([feedback, review, other])).toEqual([
      { rank: 1, count: 1, firstId: 'hb#3' },
      { rank: 2, count: 2, firstId: 'hb#1' },
    ])
  })
})

describe('note du vault', () => {
  it('reprend les blocs du daily en version courte', () => {
    const blocked = topic('web#5', { blocked: 'Attend le design' })
    const sheet = buildDaily(
      input({
        topics: [blocked],
        views: [view(blocked, [])],
        run: {
          date: '2026-11-10',
          status: 'ready',
          content: {
            generatedAt: at(10, 9, 31).toISOString(),
            intentions: [],
            titles: {},
            unblock: { 'web#5': 'Relancer Nicolas' },
            health: [{ source: 'Sentry', level: 'alert', text: '2 régressions', detail: 'Crash au login', url: null }],
          },
        },
      }),
    )
    const note = renderDailyNote(sheet, at(10, 9, 32))
    expect(note).toContain('# Daily — 2026-11-10')
    expect(note).toContain('généré le 09:31')
    expect(note).toContain('- Sujet web#5 (web#5) — Attend le design · pour avancer : Relancer Nicolas')
    expect(note).toContain('- 🔴 **Sentry** : 2 régressions — Crash au login')
  })
})

function review(id: string, date: Date, overrides: Partial<StoreReview> = {}): StoreReview {
  return {
    id,
    app: 'Ouihelp Pro',
    store: 'play-store',
    rating: 2,
    title: null,
    text: `Avis ${id}`,
    author: 'Camille',
    date: date.toISOString(),
    version: '4.2.0',
    url: `https://play.example.test/${id}`,
    ...overrides,
  }
}

describe('retours stores', () => {
  it('garde les avis depuis le dernier jour ouvré, du plus récent au plus ancien', () => {
    const feed = {
      reviews: [review('vendredi', at(6, 18)), review('lundi', at(9, 0, 5)), review('ce-matin', at(10, 8))],
      failed: [{ app: 'Joya Pro', store: 'app-store' as const }],
    }
    const kept = newReviews(feed, at(10, 9, 30))
    expect(kept?.reviews.map(item => item.id)).toEqual(['ce-matin', 'lundi'])
    expect(kept?.failed).toEqual(feed.failed)
    const monday = { reviews: feed.reviews.slice(0, 2), failed: [] }
    expect(newReviews(monday, at(9, 9, 30))?.reviews.map(item => item.id)).toEqual(['lundi', 'vendredi'])
  })

  it('en montre huit au plus et rien sans application suivie', () => {
    const many = Array.from({ length: 12 }, (_, index) => review(`r${index}`, at(10, 8, index)))
    expect(newReviews({ reviews: many, failed: [] }, at(10, 9, 30))?.reviews).toHaveLength(8)
    expect(newReviews(null, at(10, 9, 30))).toBeNull()
  })

  it('les écrit dans la note avec les chiffres de santé', () => {
    const sheet = buildDaily(
      input({
        reviews: {
          reviews: [review('r1', at(10, 8), { store: 'app-store', title: 'Plante', text: 'Écran  blanc\nau login', rating: 1 })],
          failed: [{ app: 'Joya Pro', store: 'play-store' }],
        },
        run: {
          date: '2026-11-10',
          status: 'ready',
          content: {
            generatedAt: at(10, 9, 31).toISOString(),
            intentions: [],
            titles: {},
            unblock: {},
            health: [
              {
                source: 'Erreurs app',
                level: 'weak',
                text: 'Télétransmission en hausse',
                detail: null,
                url: null,
                items: [{ label: 'TELEPROCESSING_FAILED', value: '45 users · +60 %' }],
              },
            ],
          },
        },
      }),
    )
    const note = renderDailyNote(sheet, at(10, 9, 32))
    expect(note).toContain('- 🟡 **Erreurs app** : Télétransmission en hausse\n  - TELEPROCESSING_FAILED : 45 users · +60 %')
    expect(note).toContain('## Retours stores')
    expect(note).toContain('- ★☆☆☆☆ Ouihelp Pro · App Store · 10/11 — **Plante** — Écran blanc au login ([voir](https://play.example.test/r1))')
    expect(note).toContain('- Google Play injoignable pour Joya Pro')
  })

  it('n’ajoute pas la section un jour sans nouvel avis', () => {
    const sheet = buildDaily(input({ reviews: { reviews: [review('vieux', at(2, 10))], failed: [] } }))
    expect(renderDailyNote(sheet, at(10, 9, 32))).not.toContain('Retours stores')
  })
})
