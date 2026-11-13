import { describe, expect, it } from 'vitest'
import type { Workspace } from '../src/main/config'
import { itemFromTicket } from '../src/main/engine/rank'
import { jiraQuery, ticketFromJiraIssue, type RawJiraIssue } from '../src/main/sources/jira'
import {
  githubScope,
  owns,
  projectsFromWorkspaces,
  resolveWorkspace,
  topicVisible,
  workspacesFromProjects,
} from '../src/main/workspaces'
import type { Topic, TrackedProject } from '../src/shared/types'

const SHOP: Workspace = {
  id: 'shop',
  label: 'Boutique',
  short: 'SHOP',
  jiraProjects: ['SHOP'],
  github: { owner: 'acme', repos: ['shop-api', 'shop-app'] },
}
const BLOG: Workspace = {
  id: 'blog',
  label: 'Blog',
  short: 'BLOG',
  jiraProjects: ['BLOG'],
  github: { owner: 'acme', repos: ['blog-web'] },
}
const ALL = [SHOP, BLOG]

function topic(links: string[]): Topic {
  return { id: links.join('-') || 'note', title: 't', status: 'open', links, threads: [], createdAt: '', body: '' }
}

describe('espaces de travail', () => {
  it('prend le premier espace quand rien n’est choisi', () => {
    expect(resolveWorkspace(ALL, null)?.id).toBe('shop')
    expect(resolveWorkspace(ALL, 'blog')?.id).toBe('blog')
    expect(resolveWorkspace(ALL, 'disparu')?.id).toBe('shop')
    expect(resolveWorkspace([], 'blog')).toBeNull()
  })

  it('reconnaît les tickets et les PR de chaque espace', () => {
    expect(owns(BLOG, 'BLOG-12')).toBe(true)
    expect(owns(BLOG, 'SHOP-12')).toBe(false)
    expect(owns(SHOP, 'shop-app#40')).toBe(true)
    expect(owns(BLOG, 'shop-app#40')).toBe(false)
  })

  it('cache les sujets de l’autre produit et garde les notes libres', () => {
    expect(topicVisible(topic(['SHOP-3', 'shop-api#9']), BLOG, ALL)).toBe(false)
    expect(topicVisible(topic(['BLOG-3', 'blog-web#9']), BLOG, ALL)).toBe(true)
    expect(topicVisible(topic([]), BLOG, ALL)).toBe(true)
    expect(topicVisible(topic(['OPS-1']), BLOG, ALL)).toBe(true)
    expect(topicVisible(topic(['SHOP-3', 'BLOG-4']), BLOG, ALL)).toBe(true)
    expect(topicVisible(topic(['SHOP-3']), null, ALL)).toBe(true)
  })

  it('limite la recherche GitHub aux dépôts de l’espace', () => {
    expect(githubScope(SHOP, '').qualifiers).toBe(' repo:acme/shop-api repo:acme/shop-app')
    expect(githubScope({ ...BLOG, github: { owner: 'blog-org' } }, 'acme').qualifiers).toBe(' org:blog-org')
    expect(githubScope(null, 'acme')).toEqual({ qualifiers: ' org:acme', owner: 'acme' })
  })
})

describe('Jira', () => {
  const raw = (status: string, category: string, assignee: string | null): RawJiraIssue => ({
    key: 'BLOG-42',
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
      key: 'BLOG-42',
      url: 'https://acme.atlassian.net/browse/BLOG-42',
      assignedToMe: true,
      stateType: 'started',
      tracker: 'jira',
    })
    const item = itemFromTicket(ticket, { me: 'me', now: new Date('2026-11-09') })
    expect(item.ball).toBe('me')
    expect(item.signals[0].action).toBe('diagnostic')
  })

  it('laisse la review aux autres et clôt les tickets terminés', () => {
    const now = new Date('2026-11-09')
    for (const status of ['Code Review', 'Dev Done']) {
      const handed = ticketFromJiraIssue(raw(status, 'indeterminate', 'me'), 'https://x', 'me')
      expect(itemFromTicket(handed, { me: 'me', now }).ball).toBe('others')
    }
    const done = ticketFromJiraIssue(raw('Terminé', 'done', 'me'), 'https://x', 'me')
    expect(itemFromTicket(done, { me: 'me', now: new Date() }).terminal).toBe(true)
  })

  it('suit tous les projets quand aucun espace n’est configuré', () => {
    expect(jiraQuery([], ['APP-1'])).toBe(
      '(assignee = currentUser() AND statusCategory != Done) OR key in (APP-1) ORDER BY updated DESC',
    )
  })

  it('ne cherche les tickets liés que dans les projets de l’espace', () => {
    expect(jiraQuery(['BLOG'], ['BLOG-1', 'SHOP-2'])).toBe(
      'project in ("BLOG") AND ((assignee = currentUser() AND statusCategory != Done) OR key in (BLOG-1)) ORDER BY updated DESC',
    )
  })
})

describe('projets suivis', () => {
  const projects: TrackedProject[] = [
    { tracker: 'jira', key: 'SHOP', name: 'Boutique', repos: ['acme/shop-app'], noReview: [] },
    { tracker: 'linear', key: 'WEB', name: 'Site', repos: ['acme/web'], noReview: ['acme/web'] },
  ]

  it('fait un espace par projet, nommé par sa clef', () => {
    const [shop, web] = workspacesFromProjects(projects)
    expect(shop).toMatchObject({ id: 'shop', short: 'SHOP', label: 'Boutique', jiraProjects: ['SHOP'] })
    expect(web).toMatchObject({ id: 'web', jiraProjects: [], linearTeams: ['WEB'] })
    expect(web.github).toEqual({ repos: ['acme/web'], noReview: ['acme/web'] })
  })

  it('rattache un ticket Linear à son équipe', () => {
    const [, web] = workspacesFromProjects(projects)
    expect(owns(web, 'WEB-12')).toBe(true)
    expect(owns(web, 'SHOP-12')).toBe(false)
    expect(owns(web, 'web#3')).toBe(true)
  })

  it('part de config.json, un projet par clef, avec les dépôts complets', () => {
    const fromConfig = projectsFromWorkspaces([
      {
        id: 'blog',
        label: 'Blog',
        short: 'BLOG',
        jiraProjects: ['BLOG', 'NEWS'],
        github: { owner: 'acme', repos: ['blog-app'], noReview: ['blog-app'] },
      },
    ])
    expect(fromConfig).toEqual([
      { tracker: 'jira', key: 'BLOG', name: 'BLOG', repos: ['acme/blog-app'], noReview: ['acme/blog-app'] },
      { tracker: 'jira', key: 'NEWS', name: 'NEWS', repos: ['acme/blog-app'], noReview: ['acme/blog-app'] },
    ])
  })
})
