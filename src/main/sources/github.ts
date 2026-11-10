import type { MergedPr } from '../../shared/types'
import { run } from '../exec'
import { CONFIG } from '../config'
import { BIN } from '../paths'
import { prRef, type PullRequest, type ReviewThread } from '../engine/rank'

export const GITHUB_HOST = CONFIG.github.host
const HOST = GITHUB_HOST
const ENDPOINT = `https://api.${HOST}/graphql`
const OWNER = CONFIG.github.owner
const SCOPE = OWNER ? ` org:${OWNER}` : ''

const FRAGMENT = `fragment PR on PullRequest {
  number title url state isDraft updatedAt mergedAt closedAt headRefName reviewDecision mergeStateStatus
  repository { name } author { login }
  viewerLatestReview { state submittedAt }
  latestOpinionatedReviews(first: 20) { nodes { author { login } state submittedAt } }
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
  latestOpinionatedReviews: {
    nodes: Array<{ author: RawActor | null; state: string; submittedAt: string | null }>
  }
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

// A comment posted after an approval does not withdraw it: only the latest approve or
// request-changes review counts, and GitHub marks it dismissed when the repo voids stale approvals
function approvedAt(raw: RawPullRequest, me: string): string | null {
  const opinion = raw.latestOpinionatedReviews.nodes.find(review => review.author?.login === me)
  const review = opinion ?? raw.viewerLatestReview
  return review?.state === 'APPROVED' ? review.submittedAt : null
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
    approvedAt: approvedAt(raw, me),
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

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = (await run(BIN.gh, ['auth', 'token', '--hostname', HOST])).trim()
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`GitHub ${response.status}`)
  const payload = (await response.json()) as { data: T; errors?: Array<{ message: string }> }
  if (payload.errors?.length) throw new Error(payload.errors[0].message)
  return payload.data
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

export async function fetchGithub(extraRefs: string[], mergedSince: string): Promise<GithubSnapshot> {
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
    `query($open: String!, $merged: String!) {
      viewer { login }
      open: search(query: $open, type: ISSUE, first: 50) { nodes { ...PR } }
      merged: search(query: $merged, type: ISSUE, first: 30) {
        nodes { ... on PullRequest { number title url mergedAt repository { name } } }
      }
    }
    ${FRAGMENT}`,
    {
      open: `is:pr is:open involves:@me${SCOPE} sort:updated-desc`,
      merged: `is:pr author:@me${SCOPE} merged:>=${mergedSince}`,
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
          `p${index}: repository(owner: ${JSON.stringify(OWNER || me)}, name: ${JSON.stringify(repo)}) { pullRequest(number: ${number}) { ...PR } }`,
      )
      .join('\n')
    const result = await graphql<Record<string, { pullRequest: RawPullRequest | null }>>(
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
