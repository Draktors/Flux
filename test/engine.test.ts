import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizePullRequest, type RawPullRequest } from '../src/main/sources/github'
import {
  itemFromPullRequest,
  itemFromTicket,
  ticketKeys,
  type PullRequest,
  type Ticket,
} from '../src/main/engine/rank'
import { compareViews, reconcile } from '../src/main/engine/ball'
import { decide, EMPTY_NOTIFY_STATE, type NotifyContext } from '../src/main/engine/notify'
import type { Item, Topic, TopicView } from '../src/shared/types'
import { noteFromText, parseTopic, serializeTopic } from '../src/main/store/topics'

const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures/prs.json'), 'utf8')) as {
  data: { search: { nodes: RawPullRequest[] } }
}
const NOW = new Date('2026-11-06T12:40:00+01:00')
const ME = 'alex'
const context = { me: ME, now: NOW }
const prs = raw.data.search.nodes.map(node => normalizePullRequest(node, ME))
const items = prs.map(pr => itemFromPullRequest(pr, context))
const byRef = new Map(items.map(item => [item.ref, item]))
const rankOf = (ref: string) => byRef.get(ref)?.signals[0]?.rank

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    repo: 'mobile',
    number: 1,
    title: 'Sujet',
    url: 'https://example.test/1',
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-11-06T09:00:00Z',
    mergedAt: null,
    headRefName: 'feature/app-1',
    reviewDecision: 'REVIEW_REQUIRED',
    mergeStateStatus: 'CLEAN',
    author: ME,
    ci: 'SUCCESS',
    lastCommitAt: '2026-11-06T08:00:00Z',
    viewerReview: null,
    reviewRequested: false,
    requestedAt: null,
    pendingReview: null,
    threads: [],
    ...overrides,
  }
}

describe('file sur les données réelles du 06/11', () => {
  it('met la review oubliée au rang 0, même sur une PR bloquée', () => {
    expect(rankOf('family#221')).toBe(0)
    expect(byRef.get('family#221')?.signals[0].detail).toContain('2 commentaires non soumis')
  })

  it('compte les retours humains au rang 1', () => {
    expect(rankOf('mobile#1592')).toBe(1)
    expect(rankOf('mobile#1596')).toBe(1)
    expect(rankOf('mobile#1595')).toBe(1)
    expect(rankOf('mobile#1516')).toBe(1)
    expect(byRef.get('mobile#1592')?.signals[0].detail).toBe('2 retours de sam')
  })

  it("ne prend pas un retour de bot pour un humain", () => {
    expect(rankOf('mobile#1591')).toBe(4)
    expect(byRef.get('api#14297')?.signals.some(signal => signal.rank === 1)).toBe(false)
  })

  it('remonte les re-reviews avant les demandes simples', () => {
    expect(byRef.get('web#6966')?.signals[0].action).toBe('re-review')
    expect(byRef.get('web#6967')?.signals[0].action).toBe('re-review')
    expect(byRef.get('web#6983')?.signals[0].action).toBe('review')
    expect(byRef.get('web#6966')?.signals[0].weight).toBeLessThan(
      byRef.get('web#6983')?.signals[0].weight ?? 0,
    )
  })

  it('garde une demande de review explicite même ancienne', () => {
    expect(rankOf('mobile#1553')).toBe(2)
  })

  it('range les zombies en dormant', () => {
    for (const ref of ['mobile#1224', 'mobile#1332', 'mobile#1444', 'admin#1028', 'mobile#1230']) {
      expect(byRef.get(ref)?.ball).toBe('dormant')
    }
    expect(byRef.get('family#220')?.ball).toBe('dormant')
  })

  it("laisse aux autres ce qui ne m'attend pas", () => {
    expect(byRef.get('web#6961')?.ball).toBe('others')
  })
})

describe('règles unitaires', () => {
  it("n'alerte pas sur une review en cours de rédaction", () => {
    const item = itemFromPullRequest(
      pr({
        author: 'sam-lee',
        pendingReview: {
          createdAt: '2026-11-06T11:00:00Z',
          updatedAt: '2026-11-06T11:30:00Z',
          comments: 1,
        },
      }),
      context,
    )
    expect(item.signals).toEqual([])
  })

  it('ignore un push après une approbation', () => {
    const item = itemFromPullRequest(
      pr({
        author: 'sam-lee',
        viewerReview: { state: 'APPROVED', submittedAt: '2026-11-05T08:00:00Z' },
      }),
      context,
    )
    expect(item.ball).toBe('others')
  })

  it('demande confirmation quand GitHub ne sait pas encore si la PR est mergeable', () => {
    const item = itemFromPullRequest(
      pr({ reviewDecision: 'APPROVED', mergeStateStatus: 'UNKNOWN' }),
      context,
    )
    expect(item.signals[0]).toMatchObject({ rank: 4, detail: 'Approuvée, mergeabilité à confirmer' })
  })

  it('extrait les clefs de ticket du titre et de la branche', () => {
    expect(ticketKeys('fix (SYN-255, ops-125) UTF-8 feature/app-978')).toEqual([
      'SYN-255',
      'OPS-125',
      'APP-978',
    ])
  })
})

const ticket = (overrides: Partial<Ticket>): Ticket => ({
  key: 'APP-1',
  title: 'Ticket',
  url: 'https://linear.test/APP-1',
  stateName: 'Backlog',
  stateType: 'backlog',
  assignedToMe: true,
  updatedAt: '2026-11-05T09:00:00Z',
  labels: [],
  notices: [],
  ...overrides,
})

describe('tickets', () => {
  it('fait remonter une mention au rang 3', () => {
    const item = itemFromTicket(
      ticket({
        notices: [
          {
            id: 'a',
            kind: 'mention',
            author: 'camille.martin',
            excerpt: 'où en est ce ticket ?',
            text: 'où en est ce ticket ?',
            at: '2026-11-05T17:25:00Z',
            url: 'https://linear.test/c',
          },
        ],
      }),
      context,
    )
    expect(item.signals[0]).toMatchObject({ rank: 3, detail: 'camille : où en est ce ticket ?' })
  })

  it('écarte un commentaire qualifié comme ne m’attendant pas', () => {
    const item = itemFromTicket(
      ticket({
        notices: [
          {
            id: 'a',
            kind: 'comment',
            author: 'taylor.kim',
            excerpt: 'archivé',
            text: 'archivé',
            at: '2026-11-05T17:25:00Z',
            url: 'https://linear.test/c',
            waitingOnMe: false,
          },
        ],
      }),
      context,
    )
    expect(item.signals).toEqual([])
  })

  it('classe les états de ticket', () => {
    const rank = (stateName: string) =>
      itemFromTicket(ticket({ stateName }), context).signals[0]?.rank
    expect(rank('To frame')).toBe(3)
    expect(rank('Ready to deploy')).toBe(4)
    expect(rank('Personal Review')).toBe(6)
    expect(rank('Backlog')).toBeUndefined()
  })

  it('propose le diagnostic sur un ticket de bug', () => {
    const item = itemFromTicket(ticket({ stateName: 'In Progress', labels: ['Vrai bug'] }), context)
    expect(item.signals[0].action).toBe('diagnostic')
  })
})

const topic = (overrides: Partial<Topic>): Topic => ({
  id: 't1',
  title: 'Sujet',
  status: 'open',
  links: [],
  threads: [],
  createdAt: '2026-11-01T09:00:00Z',
  body: '',
  ...overrides,
})

const ticketItem = (overrides: Partial<Item> = {}): Item =>
  ({ ...itemFromTicket(ticket({ stateName: 'In Progress' }), context), ...overrides })

describe('rapprochement sujets / signaux', () => {
  it('fusionne une PR et son ticket dans un seul sujet', () => {
    const prItem = itemFromPullRequest(
      pr({ title: 'feat (APP-1)', isDraft: true, headRefName: 'feature/app-1' }),
      context,
    )
    const result = reconcile([], [prItem, ticketItem()], [], NOW)
    expect(result.created).toHaveLength(1)
    expect(result.created[0].links).toEqual(['mobile#1', 'APP-1'])
    expect(result.views[0].items).toHaveLength(2)
  })

  it('ne crée pas de sujet pour ce qui attend les autres', () => {
    const item = itemFromPullRequest(pr({ author: 'sam-lee' }), context)
    expect(reconcile([], [item], [], NOW).created).toEqual([])
  })

  it('ferme un sujet dont tous les liens sont terminés', () => {
    const merged = itemFromPullRequest(pr({ state: 'MERGED' }), context)
    const done = itemFromTicket(ticket({ stateType: 'completed' }), context)
    const result = reconcile(
      [topic({ links: ['mobile#1', 'APP-1'] })],
      [merged, done],
      [],
      NOW,
    )
    expect(result.closed).toEqual(['t1'])
  })

  it('garde ouvert tant qu’un lien est encore vivant ou inconnu', () => {
    const merged = itemFromPullRequest(pr({ state: 'MERGED' }), context)
    const result = reconcile([topic({ links: ['mobile#1', 'APP-1'] })], [merged], [], NOW)
    expect(result.closed).toEqual([])
  })

  it('ne ferme jamais une note sans lien', () => {
    const result = reconcile([topic({ links: [] })], [], [], NOW)
    expect(result.closed).toEqual([])
    expect(result.views[0].signals[0]).toMatchObject({ rank: 6, detail: 'Tâche' })
  })

  it('sort de la file un sujet sur lequel un agent travaille', () => {
    const thread = { session: 's1', name: 'x', cwd: '/', startedAt: '2026-11-06T10:00:00Z' }
    const result = reconcile(
      [topic({ links: ['APP-1'], threads: [thread] })],
      [ticketItem()],
      [{ session: 's1', status: 'busy' }],
      NOW,
    )
    expect(result.views[0].ball).toBe('agent')
  })

  it('remonte un thread inactif sans autre signal au rang 5', () => {
    const thread = { session: 's1', name: 'x', cwd: '/', startedAt: '2026-11-06T10:00:00Z' }
    const result = reconcile(
      [topic({ threads: [thread] })],
      [],
      [{ session: 's1', status: 'idle' }],
      NOW,
    )
    expect(result.views[0].rank).toBe(5)
  })

  it('montre un thread Desktop pas encore envoyé comme en attente, sans signal', () => {
    const thread = {
      session: 'd1',
      dir: 'd1',
      name: 'x',
      cwd: '/',
      startedAt: '2026-11-06T10:00:00Z',
      pending: true,
    }
    const result = reconcile([topic({ threads: [thread] })], [], [], NOW)
    expect(result.views[0].threads[0].status).toBe('pending')
    expect(result.views[0].signals.some(signal => signal.id.startsWith('thread:'))).toBe(false)
  })

  it('tient un sujet bloqué hors de la file', () => {
    const result = reconcile(
      [topic({ links: ['APP-1'], blocked: 'attend Sam' })],
      [ticketItem()],
      [],
      NOW,
    )
    expect(result.views[0].ball).toBe('others')
  })

  it('ne recrée pas un sujet clos à la main sans activité nouvelle', () => {
    const done = topic({ status: 'done', links: ['APP-1'], closedAt: '2026-11-06T11:00:00Z' })
    const result = reconcile([done], [ticketItem()], [], NOW)
    expect(result.created).toEqual([])
    expect(result.reopened).toEqual([])
  })

  it('rouvre un sujet clos quand une activité nouvelle arrive', () => {
    const done = topic({ status: 'done', links: ['APP-1'], closedAt: '2026-11-04T11:00:00Z' })
    const result = reconcile([done], [ticketItem()], [], NOW)
    expect(result.reopened).toEqual(['t1'])
  })

  it('trie la file par rang, poids puis ancienneté', () => {
    const result = reconcile([], items, [], NOW)
    const queue = result.views.filter(view => view.ball === 'me').sort(compareViews)
    expect(queue[0].topic.links).toContain('family#221')
    const ranks = queue.map(view => view.rank ?? 9)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })
})

const view = (id: string, signalId: string, stamp: string, rank: 1 | 4 = 1): TopicView => ({
  topic: topic({ id, title: id }),
  items: [],
  signals: [{ id: signalId, rank, weight: 0, detail: 'détail', since: stamp, stamp, action: 'review' }],
  threads: [],
  rank,
  ball: 'me',
  since: stamp,
  actions: [],
})

const during = (iso: string, meeting: NotifyContext['meeting'] = null): NotifyContext => ({
  now: new Date(iso),
  meeting,
  workdayStart: 9,
  workdayEnd: 19,
})

describe('notifications', () => {
  const ready = { ...EMPTY_NOTIFY_STATE, initialized: true }

  it('résume la file au premier lancement au lieu de tout envoyer', () => {
    const { notifications, state } = decide(
      EMPTY_NOTIFY_STATE,
      [view('a', 'a:1', '2026-11-06T09:00:00Z'), view('b', 'b:1', '2026-11-06T09:00:00Z')],
      during('2026-11-06T11:00:00+01:00'),
    )
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe("2 sujets t'attendent")
    expect(state.seen['b:1']).toBeDefined()
  })

  it('notifie un nouveau signal de rang 0 à 3', () => {
    const { notifications } = decide(
      ready,
      [view('a', 'a:1', '2026-11-06T09:00:00Z')],
      during('2026-11-06T11:00:00+01:00'),
    )
    expect(notifications[0].topicId).toBe('a')
  })

  it('ne notifie pas un nouveau signal de rang 4', () => {
    const { notifications } = decide(
      ready,
      [view('a', 'a:1', '2026-11-06T09:00:00Z', 4)],
      during('2026-11-06T11:00:00+01:00'),
    )
    expect(notifications).toEqual([])
  })

  it('renotifie quand un signal connu évolue', () => {
    const first = decide(
      ready,
      [view('a', 'a:1', '2026-11-06T09:00:00Z')],
      during('2026-11-06T11:00:00+01:00'),
    )
    const second = decide(
      first.state,
      [view('a', 'a:1', '2026-11-06T10:30:00Z')],
      during('2026-11-06T11:30:00+01:00'),
    )
    expect(second.notifications).toHaveLength(1)
  })

  it('ne renotifie pas un signal ancien resté dans la file', () => {
    const queue = [view('a', 'a:1', '2026-09-01T09:00:00Z')]
    const first = decide(ready, queue, during('2026-11-06T11:00:00+01:00'))
    expect(first.notifications).toHaveLength(1)
    const next = decide(first.state, queue, during('2026-11-06T11:01:00+01:00'))
    expect(next.notifications).toEqual([])
  })

  it('oublie après 30 jours un signal sorti de la file', () => {
    const first = decide(ready, [view('a', 'a:1', '2026-09-01T09:00:00Z')], during('2026-11-06T11:00:00+01:00'))
    const gone = decide(first.state, [], during('2026-11-06T11:01:00+01:00'))
    expect(gone.state.seen['a:1']).toBeUndefined()
  })

  it('garde tout pendant une réunion puis groupe à la fin', () => {
    const queue = [view('a', 'a:1', '2026-11-06T09:00:00Z'), view('b', 'b:1', '2026-11-06T09:30:00Z')]
    const meeting = { title: 'Point', start: '2026-11-06T09:30:00Z', end: '2026-11-06T10:30:00Z' }
    const held = decide(ready, queue, during('2026-11-06T11:00:00+01:00', meeting))
    expect(held.notifications).toEqual([])
    const after = decide(held.state, queue, during('2026-11-06T11:31:00+01:00'))
    expect(after.notifications).toHaveLength(1)
    expect(after.notifications[0].title).toBe('2 nouveaux sujets à débloquer')
  })

  it('reste silencieux la nuit et le week-end', () => {
    const queue = [view('a', 'a:1', '2026-11-06T09:00:00Z')]
    expect(decide(ready, queue, during('2026-11-06T21:00:00+01:00')).notifications).toEqual([])
    expect(decide(ready, queue, during('2026-11-07T11:00:00+01:00')).notifications).toEqual([])
  })

  it('relance une tête de file inchangée après 2 h, pas avant', () => {
    const queue = [view('a', 'a:1', '2026-11-06T09:00:00Z')]
    const first = decide(ready, queue, during('2026-11-06T10:00:00+01:00'))
    const early = decide(first.state, queue, during('2026-11-06T11:30:00+01:00'))
    expect(early.notifications).toEqual([])
    const late = decide(early.state, queue, during('2026-11-06T12:01:00+01:00'))
    expect(late.notifications[0].title).toContain('Toujours en tête')
    const again = decide(late.state, queue, during('2026-11-06T12:30:00+01:00'))
    expect(again.notifications).toEqual([])
  })
})

describe('fichiers sujet', () => {
  it('relit à l’identique ce qu’il écrit', () => {
    const original = topic({
      title: 'Review: web#6983 — écran',
      links: ['web#6983', 'APP-1005'],
      threads: [{ session: 'uuid', name: 'hb', cwd: '/tmp', startedAt: '2026-11-06T14:02:00Z' }],
      body: 'Note libre\n\n---\n\nAvec un séparateur.',
    })
    expect(parseTopic(serializeTopic(original), 'x')).toEqual(original)
  })

  it('accepte une note écrite à la main dans Obsidian', () => {
    const parsed = parseTopic('---\ntitle: Relancer Sam\nstatus: open\n---\nCorps', 'fichier')
    expect(parsed).toMatchObject({ id: 'fichier', title: 'Relancer Sam', links: [], body: 'Corps' })
  })

  it('ignore un fichier sans en-tête', () => {
    expect(parseTopic('juste du texte', 'x')).toBeNull()
  })

  it('tire le titre et le corps de la capture', () => {
    const note = noteFromText('Relancer Sam sur l’écran\nIl attend la spec', NOW)
    expect(note).toMatchObject({
      title: 'Relancer Sam sur l’écran',
      body: 'Il attend la spec',
      status: 'inbox',
    })
    expect(note.id).toMatch(/relancer-sam-sur-l-ecran$/)
  })
})
