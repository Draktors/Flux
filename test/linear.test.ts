import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchLinear,
  linkedFilter,
  mergeTickets,
  noticeFromNotification,
  type RawNotification,
} from '../src/main/sources/linear'

const NOW = new Date('2026-11-06T12:00:00Z')

const issue = (overrides: Record<string, unknown> = {}) => ({
  identifier: 'WEB-3434',
  title: 'Volume saturé',
  url: 'https://linear.app/acme/issue/WEB-3434',
  updatedAt: '2026-11-05T17:25:29Z',
  state: { name: 'Backlog', type: 'backlog' },
  assignee: { isMe: true },
  labels: { nodes: [] },
  ...overrides,
})

const notification = (overrides: Partial<RawNotification> = {}): RawNotification => ({
  id: 'n1',
  type: 'issueCommentMention',
  readAt: null,
  snoozedUntilAt: null,
  archivedAt: null,
  createdAt: '2026-11-05T17:25:30Z',
  subtitle: 'camille.martin mentioned you: @alex où en est ce ticket ?',
  actor: { displayName: 'camille.martin', name: 'Camille' },
  botActor: null,
  issue: issue(),
  comment: {
    id: 'c1',
    body: '@alex où en est ce ticket ? Passation prévue ?',
    url: 'https://linear.app/acme/issue/WEB-3434#comment-1',
    createdAt: '2026-11-05T17:25:30Z',
  },
  ...overrides,
})

describe('filtrage de l’inbox Linear', () => {
  it('garde une mention, même sur un ticket qui n’est pas à moi', () => {
    const notice = noticeFromNotification(
      notification({ issue: issue({ assignee: { isMe: false } }) }),
      NOW,
    )
    expect(notice).toMatchObject({ kind: 'mention', author: 'camille.martin', id: 'c1' })
  })

  it('garde un commentaire humain sur mon ticket ouvert', () => {
    expect(noticeFromNotification(notification({ type: 'issueNewComment' }), NOW)?.kind).toBe(
      'comment',
    )
  })

  it('écarte un commentaire sur le ticket de quelqu’un d’autre', () => {
    expect(
      noticeFromNotification(
        notification({ type: 'issueNewComment', issue: issue({ assignee: { isMe: false } }) }),
        NOW,
      ),
    ).toBeNull()
  })

  it.each([
    'issueStatusChanged',
    'triageResponsibilityIssueAddedToTriage',
    'feedSummaryGenerated',
    'issueUnassignedFromYou',
    'projectUpdatePrompt',
  ])('écarte le bruit %s', type => {
    expect(noticeFromNotification(notification({ type }), NOW)).toBeNull()
  })

  it('écarte les commentaires automatiques Sentry', () => {
    const comment = {
      id: 'c2',
      body: '🗄️ Archived in Sentry Status: archived until condition met',
      url: 'https://linear.test',
      createdAt: '2026-11-06T09:59:22Z',
    }
    expect(
      noticeFromNotification(notification({ type: 'issueNewComment', comment }), NOW),
    ).toBeNull()
  })

  it('écarte un bot, un ticket fermé, une notification lue ou reportée', () => {
    expect(noticeFromNotification(notification({ botActor: { name: 'Sentry' } }), NOW)).toBeNull()
    expect(
      noticeFromNotification(
        notification({ issue: issue({ state: { name: 'Done', type: 'completed' } }) }),
        NOW,
      ),
    ).toBeNull()
    expect(noticeFromNotification(notification({ readAt: '2026-11-06T08:00:00Z' }), NOW)).toBeNull()
    expect(
      noticeFromNotification(notification({ snoozedUntilAt: '2026-11-07T08:00:00Z' }), NOW),
    ).toBeNull()
  })

  it('rattache les remarques au ticket, sans doublon', () => {
    const tickets = mergeTickets(
      [issue()],
      [],
      [notification(), notification({ id: 'n2' }), notification({ type: 'issueStatusChanged' })],
      NOW,
    )
    expect(tickets).toHaveLength(1)
    expect(tickets[0].notices).toHaveLength(1)
  })
})

describe('tickets liés aux sujets', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('filtre sur les identifiants Linear, sans les PR', () => {
    expect(linkedFilter(['APP-982', 'mobile#1592', 'WEB-3434'])).toEqual({
      id: { in: ['APP-982', 'WEB-3434'] },
    })
    expect(linkedFilter(['mobile#1592'])).toBeNull()
  })

  it('ignore un ticket qu’aucun sujet ne référence, même si Linear le renvoie', async () => {
    const data = {
      viewer: { assignedIssues: { nodes: [] } },
      linked: {
        nodes: [
          issue({ identifier: 'APP-982', assignee: { isMe: false } }),
          issue({ identifier: 'ACC-5435', assignee: { isMe: false } }),
        ],
      },
      notifications: { nodes: [] },
    }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data })))
    const tickets = await fetchLinear('clef', ['APP-982'])
    expect(tickets.map(ticket => ticket.key)).toEqual(['APP-982'])
  })
})
