import type { GithubProfile, MergedPr } from '../../shared/types'
import { run } from '../exec'
import { CONFIG } from '../config'
import { BIN } from '../paths'
import { prRef, type PullRequest, type ReviewThread } from '../engine/rank'
import type { GithubScope } from '../workspaces'

export const GITHUB_HOST = CONFIG.github.host
const HOST = GITHUB_HOST
const ENDPOINT = `https://api.${HOST}/graphql`
const OWNER = CONFIG.github.owner
const DEFAULT_SCOPE: GithubScope = { qualifiers: OWNER ? ` org:${OWNER}` : '', owner: OWNER }

const FRAGMENT = `fragment PR on PullRequest {
  number title url state isDraft updatedAt mergedAt closedAt headRefName reviewDecision mergeStateStatus
  repository { name } author { login }
  viewerLatestReview { state submittedAt }
  viewerLatestReviewRequest { id }
  timelineItems(last: 3, itemTypes: [REVIEW_REQUESTED_EVENT]) {
    nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } }
  }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
  reviews(first: 5, states: PENDING) { nodes { author { login } createdAt updatedAt comments { totalCount } } }
  reviewThreads(first: 60) { nodes {
    isResolved
    first: comments(first: 1) { nodes { author { login } } }
    last: comments(last: 1) { nodes { author { login } createdAt } }
  } }
}`

interface RawActor {
  login: string
}

interface RawThread {
  isResolved: boolean
  first: { nodes: Array<{ author: RawActor | null }> }
  last: { nodes: Array<{ author: RawActor | null; createdAt: string }> }
}

export interface RawPullRequest {
  number: number
  title: string
  url: string
  state: PullRequest['state']
  isDraft: boolean
  updatedAt: string
  mergedAt: string | null
  headRefName: string
  reviewDecision: string | null
  mergeStateStatus: string | null
  repository: { name: string }
  author: RawActor | null
  viewerLatestReview: { state: string; submittedAt: string | null } | null
  viewerLatestReviewRequest: { id: string } | null
  timelineItems: {
    nodes: Array<{ createdAt: string; requestedReviewer: { login?: string } | null }>
  }
  commits: {
    nodes: Array<{ commit: { committedDate: string; statusCheckRollup: { state: string } | null } }>
  }
  reviews: {
    nodes: Array<{
      author: RawActor | null
      createdAt: string
      updatedAt: string
      comments: { totalCount: number }
    }>
  }
  reviewThreads: { nodes: RawThread[] }
}

function normalizeThread(raw: RawThread): ReviewThread {
  const last = raw.last.nodes[0]
  return {
    resolved: raw.isResolved,
    firstAuthor: raw.first.nodes[0]?.author?.login ?? null,
    lastAuthor: last?.author?.login ?? null,
    lastAt: last?.createdAt ?? '',
  }
}

export function normalizePullRequest(raw: RawPullRequest, me: string): PullRequest {
  const commit = raw.commits.nodes[0]?.commit
  const pending = raw.reviews.nodes.find(review => review.author?.login === me)
  const request = raw.timelineItems.nodes
    .filter(event => event.requestedReviewer?.login === me)
    .at(-1)
  return {
    repo: raw.repository.name,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state,
    isDraft: raw.isDraft,
    updatedAt: raw.updatedAt,
    mergedAt: raw.mergedAt,
    headRefName: raw.headRefName,
    reviewDecision: raw.reviewDecision,
    mergeStateStatus: raw.mergeStateStatus,
    author: raw.author?.login ?? 'ghost',
    ci: commit?.statusCheckRollup?.state ?? null,
    lastCommitAt: commit?.committedDate ?? raw.updatedAt,
    viewerReview: raw.viewerLatestReview,
    reviewRequested: raw.viewerLatestReviewRequest !== null,
    requestedAt: request?.createdAt ?? null,
    pendingReview: pending
      ? {
          createdAt: pending.createdAt,
          updatedAt: pending.updatedAt,
          comments: pending.comments.totalCount,
        }
      : null,
    threads: raw.reviewThreads.nodes.map(normalizeThread),
  }
}

// The account flag only picks which stored token gh prints; gh's active account stays as it is
export function tokenArgs(account: string | null): string[] {
  return ['auth', 'token', '--hostname', HOST, ...(account ? ['--user', account] : [])]
}

interface AuthStatus {
  hosts: Record<string, Array<{ login: string; active: boolean; state: string }>>
}

export function parseAccounts(json: string, host: string): { logins: string[]; active: string | null } {
  const entries = ((JSON.parse(json) as AuthStatus).hosts[host] ?? []).filter(
    entry => entry.state === 'success',
  )
  const active = entries.find(entry => entry.active)?.login ?? null
  const logins = entries
    .map(entry => entry.login)
    .sort((a, b) => Number(b === active) - Number(a === active))
  return { logins, active }
}

async function graphql<T>(
  account: string | null,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const send = async () => {
    const token = (await run(BIN.gh, tokenArgs(account))).trim()
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    })
  }
  let response = await send()
  // A token read while gh refreshes it can be refused once; a fresh read gets the good one
  if (response.status === 401) response = await send()
  if (!response.ok) throw new Error(`GitHub ${response.status}`)
  const payload = (await response.json()) as { data: T; errors?: Array<{ message: string }> }
  if (payload.errors?.length) throw new Error(payload.errors[0].message)
  return payload.data
}

async function fetchAvatar(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !type.startsWith('image/')) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return `data:${type};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

// Each account reads its own profile with its own token, so private names show too
async function fetchProfile(login: string): Promise<GithubProfile> {
  try {
    const { viewer } = await graphql<{ viewer: { name: string | null; avatarUrl: string } }>(
      login,
      'query { viewer { name avatarUrl(size: 64) } }',
    )
    return { name: viewer.name || null, avatar: await fetchAvatar(viewer.avatarUrl) }
  } catch {
    return { name: null, avatar: null }
  }
}

interface AccountList {
  logins: string[]
  active: string | null
  profiles: Record<string, GithubProfile>
}

// gh auth status checks every token over the network, so the settings panel reads a cached list
const ACCOUNTS_TTL_MS = 60_000
let cachedAccounts: { at: number; value: AccountList } | null = null
let pendingAccounts: Promise<AccountList> | null = null
const profiles = new Map<string, GithubProfile>()

async function readAccounts(): Promise<AccountList> {
  const json = await run(BIN.gh, ['auth', 'status', '--hostname', HOST, '--json', 'hosts'], {
    timeoutMs: 15_000,
  })
  const accounts = parseAccounts(json, HOST)
  await Promise.all(
    accounts.logins.map(async login => {
      const known = profiles.get(login)
      if (known?.avatar) return
      profiles.set(login, await fetchProfile(login))
    }),
  )
  const value = {
    ...accounts,
    profiles: Object.fromEntries(accounts.logins.map(login => [login, profiles.get(login)!])),
  }
  cachedAccounts = { at: Date.now(), value }
  return value
}

export function listGithubAccounts(): Promise<AccountList> {
  if (cachedAccounts && Date.now() - cachedAccounts.at < ACCOUNTS_TTL_MS) {
    return Promise.resolve(cachedAccounts.value)
  }
  pendingAccounts ??= readAccounts().finally(() => {
    pendingAccounts = null
  })
  return pendingAccounts
}

function parseRef(ref: string): { repo: string; number: number } | null {
  const match = /^([a-z0-9_-]+)#(\d+)$/i.exec(ref)
  return match ? { repo: match[1], number: Number(match[2]) } : null
}

export interface GithubSnapshot {
  me: string
  pullRequests: PullRequest[]
  merged: MergedPr[]
}

export async function fetchGithub(
  extraRefs: string[],
  mergedSince: string,
  account: string | null = null,
  scope: GithubScope = DEFAULT_SCOPE,
): Promise<GithubSnapshot> {
  const data = await graphql<{
    viewer: { login: string }
    open: { nodes: RawPullRequest[] }
    merged: {
      nodes: Array<{
        number: number
        title: string
        url: string
        mergedAt: string
        repository: { name: string }
      }>
    }
  }>(
    account,
    `query($open: String!, $merged: String!) {
      viewer { login }
      open: search(query: $open, type: ISSUE, first: 50) { nodes { ...PR } }
      merged: search(query: $merged, type: ISSUE, first: 30) {
        nodes { ... on PullRequest { number title url mergedAt repository { name } } }
      }
    }
    ${FRAGMENT}`,
    {
      open: `is:pr is:open involves:@me${scope.qualifiers} sort:updated-desc`,
      merged: `is:pr author:@me${scope.qualifiers} merged:>=${mergedSince}`,
    },
  )

  const me = data.viewer.login
  const known = new Set(data.open.nodes.map(node => prRef(node.repository.name, node.number)))
  const missing = extraRefs.filter(ref => !known.has(ref)).flatMap(ref => parseRef(ref) ?? [])

  let extras: RawPullRequest[] = []
  if (missing.length > 0) {
    const selections = missing
      .map(
        ({ repo, number }, index) =>
          `p${index}: repository(owner: ${JSON.stringify(scope.owner || me)}, name: ${JSON.stringify(repo)}) { pullRequest(number: ${number}) { ...PR } }`,
      )
      .join('\n')
    const result = await graphql<Record<string, { pullRequest: RawPullRequest | null }>>(
      account,
      `query { ${selections} } ${FRAGMENT}`,
    )
    extras = Object.values(result).flatMap(entry => entry.pullRequest ?? [])
  }

  return {
    me,
    pullRequests: [...data.open.nodes, ...extras].map(raw => normalizePullRequest(raw, me)),
    merged: data.merged.nodes.map(node => ({
      ref: prRef(node.repository.name, node.number),
      title: node.title,
      url: node.url,
      mergedAt: node.mergedAt,
    })),
  }
}

// Repos you had PRs in over the last months, most active first, for attaching them to a project
export async function listRecentRepos(account: string | null, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - 120 * 86_400_000).toISOString().slice(0, 10)
  const data = await graphql<{
    search: { nodes: Array<{ repository?: { nameWithOwner: string } }> }
  }>(
    account,
    `query($q: String!) {
      search(query: $q, type: ISSUE, first: 100) {
        nodes { ... on PullRequest { repository { nameWithOwner } } }
      }
    }`,
    { q: `is:pr involves:@me updated:>=${since} sort:updated-desc` },
  )
  const counts = new Map<string, number>()
  for (const node of data.search.nodes) {
    const name = node.repository?.nameWithOwner
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
}
