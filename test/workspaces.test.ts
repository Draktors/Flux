import { describe, expect, it } from 'vitest'
import type { Workspace } from '../src/main/config'
import { itemFromTicket } from '../src/main/engine/rank'
import { jiraQuery, ticketFromJiraIssue, type RawJiraIssue } from '../src/main/sources/jira'
import { githubScope, owns, resolveWorkspace, topicVisible } from '../src/main/workspaces'
import type { Topic } from '../src/shared/types'

const PP: Workspace = {
  id: 'pp',
  label: 'PanneauPocket',
  short: 'PP',
  jiraProjects: ['PP'],
  github: { owner: 'acme', repos: ['pp-api', 'pp-app'] },
}
const CC: Workspace = {
  id: 'cc',
  label: 'Communicity',
  short: 'CC',
  jiraProjects: ['CC'],
  github: { owner: 'acme', repos: ['cc-web'] },
}
const ALL = [PP, CC]

function topic(links: string[]): Topic {
  return { id: links.join('-') || 'note', title: 't', status: 'open', links, threads: [], createdAt: '', body: '' }
}

describe('espaces de travail', () => {
  it('prend le premier espace quand rien n’est choisi', () => {
    expect(resolveWorkspace(ALL, null)?.id).toBe('pp')
    expect(resolveWorkspace(ALL, 'cc')?.id).toBe('cc')
    expect(resolveWorkspace(ALL, 'disparu')?.id).toBe('pp')
    expect(resolveWorkspace([], 'cc')).toBeNull()
  })

  it('reconnaît les tickets et les PR de chaque espace', () => {
    expect(owns(CC, 'CC-12')).toBe(true)
    expect(owns(CC, 'PP-12')).toBe(false)
    expect(owns(PP, 'pp-app#40')).toBe(true)
    expect(owns(CC, 'pp-app#40')).toBe(false)
  })

  it('cache les sujets de l’autre produit et garde les notes libres', () => {
    expect(topicVisible(topic(['PP-3', 'pp-api#9']), CC, ALL)).toBe(false)
    expect(topicVisible(topic(['CC-3', 'cc-web#9']), CC, ALL)).toBe(true)
    expect(topicVisible(topic([]), CC, ALL)).toBe(true)
    expect(topicVisible(topic(['OPS-1']), CC, ALL)).toBe(true)
    expect(topicVisible(topic(['PP-3', 'CC-4']), CC, ALL)).toBe(true)
    expect(topicVisible(topic(['PP-3']), null, ALL)).toBe(true)
  })

  it('limite la recherche GitHub aux dépôts de l’espace', () => {
    expect(githubScope(PP, '').qualifiers).toBe(' repo:acme/pp-api repo:acme/pp-app')
    expect(githubScope({ ...CC, github: { owner: 'cc-org' } }, 'acme').qualifiers).toBe(' org:cc-org')
    expect(githubScope(null, 'acme')).toEqual({ qualifiers: ' org:acme', owner: 'acme' })
  })
})

describe('Jira', () => {
  const raw = (status: string, category: string, assignee: string | null): RawJiraIssue => ({
    key: 'CC-42',
    fields: {
      summary: 'Fil d’actualité',
      updated: '2026-11-08T10:00:00.000+0100',
      labels: [],
      status: { name: status, statusCategory: { key: category } },
      assignee: assignee ? { accountId: assignee } : null,
      issuetype: { name: 'Bug' },
    },
  })

  it('traduit un ticket en cours qui m’est assigné', () => {
    const ticket = ticketFromJiraIssue(raw('En cours', 'indeterminate', 'me'), 'https://acme.atlassian.net', 'me')
    expect(ticket).toMatchObject({
      key: 'CC-42',
      url: 'https://acme.atlassian.net/browse/CC-42',
      assignedToMe: true,
      stateType: 'started',
      inProgress: true,
    })
    const item = itemFromTicket(ticket, { me: 'me', now: new Date('2026-11-09') })
    expect(item.ball).toBe('me')
    expect(item.signals[0].action).toBe('diagnostic')
  })

  it('laisse la review aux autres et clôt les tickets terminés', () => {
    const review = ticketFromJiraIssue(raw('Code Review', 'indeterminate', 'me'), 'https://x', 'me')
    expect(review.inProgress).toBe(false)
    const done = ticketFromJiraIssue(raw('Terminé', 'done', 'me'), 'https://x', 'me')
    expect(itemFromTicket(done, { me: 'me', now: new Date() }).terminal).toBe(true)
  })

  it('suit tous les projets quand aucun espace n’est configuré', () => {
    expect(jiraQuery([], ['APP-1'])).toBe(
      '(assignee = currentUser() AND statusCategory != Done) OR key in (APP-1) ORDER BY updated DESC',
    )
  })

  it('ne cherche les tickets liés que dans les projets de l’espace', () => {
    expect(jiraQuery(['CC'], ['CC-1', 'PP-2'])).toBe(
      'project in ("CC") AND ((assignee = currentUser() AND statusCategory != Done) OR key in (CC-1)) ORDER BY updated DESC',
    )
  })
})
