import { describe, expect, it } from 'vitest'
import { itemFromTicket, type Ticket } from '../src/main/engine/rank'
import { defaultRole, roleOf } from '../src/shared/statuses'

const now = new Date('2026-11-09T10:00:00Z')

const ticket = (patch: Partial<Ticket>): Ticket => ({
  key: 'BLOG-7',
  title: 'Fil d’actualité',
  url: 'https://x/browse/BLOG-7',
  stateName: 'Dev Done',
  stateType: 'started',
  assignedToMe: true,
  updatedAt: '2026-11-09T09:00:00Z',
  labels: [],
  notices: [],
  tracker: 'jira',
  ...patch,
})

describe('rôle des statuts', () => {
  it('devine d’après le nom et le type du statut', () => {
    expect(defaultRole('jira', 'En cours', 'started')).toBe('mine')
    expect(defaultRole('jira', 'Dev Done', 'started')).toBe('handedOff')
    expect(defaultRole('linear', 'In Review', 'started')).toBe('handedOff')
    expect(defaultRole('linear', 'In Progress', 'started')).toBe('mine')
    expect(defaultRole('linear', 'To frame', 'unstarted')).toBe('question')
    expect(defaultRole('jira', 'À faire', 'unstarted')).toBe('todo')
    expect(defaultRole('linear', 'Backlog', 'backlog')).toBe('parked')
    expect(defaultRole('jira', 'Terminé', 'completed')).toBe('done')
  })

  it('laisse une règle des réglages passer devant, sans tenir compte de la casse', () => {
    expect(roleOf('jira', 'Dev Done', 'started', { 'dev done': 'mine' })).toBe('mine')
    expect(roleOf('jira', 'Dev Done', 'started', {})).toBe('handedOff')
  })

  it('garde une règle à son projet', () => {
    const rules = { 'PP:dev done': 'mine' as const }
    expect(roleOf('jira', 'Dev Done', 'started', rules, 'PP')).toBe('mine')
    expect(roleOf('jira', 'Dev Done', 'started', rules, 'CCM')).toBe('handedOff')
  })

  it('range un ticket selon la règle choisie', () => {
    const context = (rules = {}) => ({ me: 'me', now, statusRules: rules })
    expect(itemFromTicket(ticket({}), context()).ball).toBe('others')
    expect(itemFromTicket(ticket({}), context({ 'BLOG:dev done': 'mine' })).ball).toBe('me')
    expect(itemFromTicket(ticket({}), context({ 'BLOG:dev done': 'done' })).terminal).toBe(true)
    const parked = itemFromTicket(ticket({ stateName: 'Icebox', assignedToMe: false }), context({ icebox: 'parked' }))
    expect(parked.ball).toBe('parked')
  })
})
