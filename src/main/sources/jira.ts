import type { Ticket } from '../engine/rank'

const FIELDS = ['summary', 'status', 'assignee', 'updated', 'labels', 'issuetype']
const PAGE_SIZE = 100
// In-progress statuses that wait on a reviewer or a tester rather than on you
const HANDED_OFF = /review|revue|test|recette|qa|valid|merge|deploy|mep|livr/i

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

const STATE_TYPES: Record<string, string> = {
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
    inProgress: category === 'indeterminate' && !HANDED_OFF.test(stateName),
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

async function search(credentials: JiraCredentials, jql: string): Promise<RawJiraIssue[]> {
  const issues: RawJiraIssue[] = []
  let nextPageToken: string | undefined
  do {
    const page = await call<{ issues: RawJiraIssue[]; nextPageToken?: string }>(
      credentials,
      '/rest/api/3/search/jql',
      { jql, fields: FIELDS, maxResults: PAGE_SIZE, nextPageToken },
    )
    issues.push(...page.issues)
    nextPageToken = page.nextPageToken
  } while (nextPageToken && issues.length < PAGE_SIZE * 3)
  return issues
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
  return issues.map(issue => ticketFromJiraIssue(issue, credentials.site, me))
}

export async function checkJira(credentials: JiraCredentials): Promise<string> {
  const me = await call<{ displayName: string }>(credentials, '/rest/api/3/myself')
  return me.displayName
}
