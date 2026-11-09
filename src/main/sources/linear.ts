import { CLOSED_STATE_TYPES, type LinearNotice, type Ticket } from '../engine/rank'

const ENDPOINT = 'https://api.linear.app/graphql'
const MENTION_TYPES = new Set(['issueCommentMention', 'issueMention'])
const COMMENT_TYPES = new Set(['issueNewComment'])
const AUTOMATED_BODY = /^\s*🗄️?\s*Archived in Sentry/u
const EXCERPT_LENGTH = 110
const TRIAGE_TEXT_LENGTH = 1_500

const ISSUE_FIELDS = `
  identifier title url updatedAt
  state { name type }
  assignee { isMe }
  labels { nodes { name } }
`

interface RawIssue {
  identifier: string
  title: string
  url: string
  updatedAt: string
  state: { name: string; type: string }
  assignee: { isMe: boolean } | null
  labels: { nodes: Array<{ name: string }> }
}

interface RawComment {
  id: string
  body: string
  url: string
  createdAt: string
}

export interface RawNotification {
  id: string
  type: string
  readAt: string | null
  snoozedUntilAt: string | null
  archivedAt: string | null
  createdAt: string
  url?: string
  subtitle?: string
  actor?: { displayName: string; name: string } | null
  botActor?: { name: string | null } | null
  issue?: RawIssue | null
  comment?: RawComment | null
}

function ticketFromIssue(issue: RawIssue): Ticket {
  return {
    key: issue.identifier,
    title: issue.title,
    url: issue.url,
    stateName: issue.state.name,
    stateType: issue.state.type,
    assignedToMe: issue.assignee?.isMe ?? false,
    updatedAt: issue.updatedAt,
    labels: issue.labels.nodes.map(label => label.name),
    notices: [],
  }
}

function excerpt(text: string): string {
  const flat = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat
}

export function noticeFromNotification(raw: RawNotification, now: Date): LinearNotice | null {
  if (raw.readAt || raw.archivedAt) return null
  if (raw.snoozedUntilAt && new Date(raw.snoozedUntilAt) > now) return null
  const issue = raw.issue
  if (!issue || CLOSED_STATE_TYPES.has(issue.state.type)) return null
  const mention = MENTION_TYPES.has(raw.type)
  if (!mention && !COMMENT_TYPES.has(raw.type)) return null
  if (raw.botActor || !raw.actor) return null
  if (!mention && !issue.assignee?.isMe) return null
  const body = raw.comment?.body ?? raw.subtitle ?? ''
  if (AUTOMATED_BODY.test(body)) return null
  return {
    id: raw.comment?.id ?? raw.id,
    kind: mention ? 'mention' : 'comment',
    author: raw.actor.displayName || raw.actor.name,
    excerpt: excerpt(body),
    text: body.slice(0, TRIAGE_TEXT_LENGTH),
    at: raw.comment?.createdAt ?? raw.createdAt,
    url: raw.comment?.url ?? raw.url ?? issue.url,
  }
}

export function mergeTickets(
  assigned: RawIssue[],
  linked: RawIssue[],
  notifications: RawNotification[],
  now: Date,
): Ticket[] {
  const tickets = new Map<string, Ticket>()
  for (const issue of [...assigned, ...linked]) {
    tickets.set(issue.identifier, ticketFromIssue(issue))
  }
  for (const notification of notifications) {
    const notice = noticeFromNotification(notification, now)
    const issue = notification.issue
    if (!notice || !issue) continue
    const ticket = tickets.get(issue.identifier) ?? ticketFromIssue(issue)
    if (!ticket.notices.some(existing => existing.id === notice.id)) ticket.notices.push(notice)
    tickets.set(issue.identifier, ticket)
  }
  return [...tickets.values()]
}

export function linkedFilter(keys: string[]): unknown {
  const identifiers = keys.filter(key => /^[A-Z]+-\d+$/.test(key))
  return identifiers.length > 0 ? { id: { in: identifiers } } : null
}

export async function fetchLinear(apiKey: string, keys: string[]): Promise<Ticket[]> {
  const filter = linkedFilter(keys)
  const query = `query($filter: IssueFilter, $withLinked: Boolean!) {
    viewer {
      assignedIssues(first: 100, filter: { state: { type: { nin: ${JSON.stringify([...CLOSED_STATE_TYPES])} } } }) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
    linked: issues(first: 100, filter: $filter) @include(if: $withLinked) {
      nodes { ${ISSUE_FIELDS} }
    }
    notifications(first: 100) {
      nodes {
        id type readAt snoozedUntilAt archivedAt createdAt
        ... on IssueNotification {
          url subtitle
          actor { displayName name }
          botActor { name }
          issue { ${ISSUE_FIELDS} }
          comment { id body url createdAt }
        }
      }
    }
  }`
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { filter, withLinked: filter !== null } }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Linear ${response.status}`)
  const payload = (await response.json()) as {
    data?: {
      viewer: { assignedIssues: { nodes: RawIssue[] } }
      linked?: { nodes: RawIssue[] }
      notifications: { nodes: RawNotification[] }
    }
    errors?: Array<{ message: string }>
  }
  if (!payload.data) throw new Error(payload.errors?.[0]?.message ?? 'Réponse Linear vide')
  const requested = new Set(keys)
  return mergeTickets(
    payload.data.viewer.assignedIssues.nodes,
    (payload.data.linked?.nodes ?? []).filter(issue => requested.has(issue.identifier)),
    payload.data.notifications.nodes,
    new Date(),
  )
}
