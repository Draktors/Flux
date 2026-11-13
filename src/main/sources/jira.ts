import type { Ticket } from '../engine/rank'
import type { TrackerStatus } from '../../shared/statuses'

const FIELDS = ['summary', 'status', 'assignee', 'updated', 'labels', 'issuetype']
const PAGE_SIZE = 100

export interface JiraCredentials {
  site: string
  email: string
  token: string
}

export interface RawJiraIssue {
  key: string
  fields: {
    summary: string
    updated: string
    labels?: string[]
    status: { name: string; statusCategory: { key: string } }
    assignee: { accountId: string } | null
    issuetype?: { name: string } | null
  }
}

export const STATE_TYPES: Record<string, string> = {
  done: 'completed',
  indeterminate: 'started',
  new: 'unstarted',
}

export function ticketFromJiraIssue(raw: RawJiraIssue, site: string, me: string): Ticket {
  const category = raw.fields.status.statusCategory.key
  const stateName = raw.fields.status.name
  const labels = [...(raw.fields.labels ?? [])]
  if (raw.fields.issuetype?.name) labels.push(raw.fields.issuetype.name)
  return {
    key: raw.key,
    title: raw.fields.summary,
    url: `${site}/browse/${raw.key}`,
    stateName,
    stateType: STATE_TYPES[category] ?? 'unstarted',
    assignedToMe: raw.fields.assignee?.accountId === me,
    updatedAt: raw.fields.updated,
    labels,
    notices: [],
    tracker: 'jira',
  }
}

// Without projects (no workspaces configured), every project you are assigned in counts
export function jiraQuery(projects: string[], linked: string[]): string {
  const mine = 'assignee = currentUser() AND statusCategory != Done'
  const keys =
    projects.length > 0 ? linked.filter(key => projects.includes(key.split('-')[0])) : linked
  const filter = keys.length > 0 ? `(${mine}) OR key in (${keys.join(', ')})` : mine
  if (projects.length === 0) return `${filter} ORDER BY updated DESC`
  const scope = `project in (${projects.map(key => JSON.stringify(key)).join(', ')})`
  return `${scope} AND (${filter}) ORDER BY updated DESC`
}

async function call<T>(credentials: JiraCredentials, path: string, body?: unknown): Promise<T> {
  const auth = Buffer.from(`${credentials.email}:${credentials.token}`).toString('base64')
  const response = await fetch(`${credentials.site}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { errorMessages?: string[] } | null
    throw new Error(payload?.errorMessages?.[0] ?? `Jira ${response.status}`)
  }
  return (await response.json()) as T
}

const accountIds = new Map<string, string>()

async function myAccountId(credentials: JiraCredentials): Promise<string> {
  const cacheKey = `${credentials.site}|${credentials.email}`
  const known = accountIds.get(cacheKey)
  if (known) return known
  const { accountId } = await call<{ accountId: string }>(credentials, '/rest/api/3/myself')
  accountIds.set(cacheKey, accountId)
  return accountId
}

async function search(
  credentials: JiraCredentials,
  jql: string,
  fields: string[] = FIELDS,
  limit = PAGE_SIZE * 3,
): Promise<RawJiraIssue[]> {
  const issues: RawJiraIssue[] = []
  let nextPageToken: string | undefined
  do {
    const page = await call<{ issues: RawJiraIssue[]; nextPageToken?: string }>(
      credentials,
      '/rest/api/3/search/jql',
      { jql, fields, maxResults: Math.min(PAGE_SIZE, limit), nextPageToken },
    )
    issues.push(...page.issues)
    nextPageToken = page.nextPageToken
  } while (nextPageToken && issues.length < limit)
  return issues
}

export const projectOf = (key: string) => key.split('-')[0]

// The keys among yours that sit in a running sprint, and the projects that run one at all:
// a Kanban project has no sprint, so its tickets stay unknown rather than "outside"
export function markSprint(tickets: Ticket[], running: Set<string>, inSprint: Set<string>): Ticket[] {
  return tickets.map(ticket =>
    running.has(projectOf(ticket.key)) ? { ...ticket, inSprint: inSprint.has(ticket.key) } : ticket,
  )
}

async function withSprint(credentials: JiraCredentials, tickets: Ticket[]): Promise<Ticket[]> {
  const open = tickets.filter(ticket => ticket.stateType !== 'completed')
  const projects = [...new Set(open.map(ticket => projectOf(ticket.key)))]
  if (projects.length === 0) return tickets
  try {
    const running = new Set<string>()
    await Promise.all(
      projects.map(async project => {
        const any = await search(credentials, `project = ${JSON.stringify(project)} AND sprint in openSprints()`, ['key'], 1)
        if (any.length > 0) running.add(project)
      }),
    )
    const keys = open.filter(ticket => running.has(projectOf(ticket.key))).map(ticket => ticket.key)
    if (keys.length === 0) return tickets
    const inSprint = await search(credentials, `key in (${keys.join(', ')}) AND sprint in openSprints()`, ['key'])
    return markSprint(tickets, running, new Set(inSprint.map(issue => issue.key)))
  } catch (error) {
    // Without the sprint, every ticket stays shown
    console.error('Sprint Jira indisponible', error)
    return tickets
  }
}

export async function fetchJira(
  credentials: JiraCredentials,
  projects: string[],
  linked: string[],
): Promise<Ticket[]> {
  const me = await myAccountId(credentials)
  let issues: RawJiraIssue[]
  try {
    issues = await search(credentials, jiraQuery(projects, linked))
  } catch (error) {
    // A deleted or moved key fails the whole JQL; fall back to your own tickets
    if (linked.length === 0) throw error
    issues = await search(credentials, jiraQuery(projects, []))
  }
  return withSprint(
    credentials,
    issues.map(issue => ticketFromJiraIssue(issue, credentials.site, me)),
  )
}

export async function checkJira(credentials: JiraCredentials): Promise<string> {
  const me = await call<{ displayName: string }>(credentials, '/rest/api/3/myself')
  return me.displayName
}

// Projects you can see, for picking the ones you work on
export async function listJiraProjects(
  credentials: JiraCredentials,
): Promise<Array<{ key: string; name: string }>> {
  const projects: Array<{ key: string; name: string }> = []
  let startAt = 0
  for (let page = 0; page < 5; page++) {
    const result = await call<{
      values: Array<{ key: string; name: string }>
      isLast?: boolean
      total?: number
    }>(credentials, `/rest/api/3/project/search?maxResults=100&orderBy=name&startAt=${startAt}`)
    projects.push(...result.values.map(({ key, name }) => ({ key, name })))
    if (result.isLast !== false || result.values.length === 0) break
    startAt += result.values.length
  }
  return projects
}

interface RawJiraStatus {
  name: string
  statusCategory: { key: string }
}

// The statuses of the projects you follow; without any, every status of the site
export async function listJiraStatuses(
  credentials: JiraCredentials,
  projects: string[],
): Promise<TrackerStatus[]> {
  const found = new Map<string, TrackerStatus>()
  const add = (status: RawJiraStatus, project: string | null) => {
    const entry = found.get(status.name) ?? {
      tracker: 'jira' as const,
      name: status.name,
      type: STATE_TYPES[status.statusCategory.key] ?? 'unstarted',
      projects: [],
    }
    if (project && !entry.projects.includes(project)) entry.projects.push(project)
    found.set(status.name, entry)
  }
  if (projects.length === 0) {
    const statuses = await call<RawJiraStatus[]>(credentials, '/rest/api/3/status')
    statuses.forEach(status => add(status, null))
  }
  await Promise.all(
    projects.map(async project => {
      const types = await call<Array<{ statuses: RawJiraStatus[] }>>(
        credentials,
        `/rest/api/3/project/${encodeURIComponent(project)}/statuses`,
      )
      for (const type of types) type.statuses.forEach(status => add(status, project))
    }),
  )
  return [...found.values()]
}
