import type { Topic, WorkspaceInfo } from '../shared/types'
import type { Workspace } from './config'

const PR_REF = /^([a-z0-9_.-]+)#\d+$/i
const TICKET_REF = /^([A-Z][A-Z0-9]*)-\d+$/

export function resolveWorkspace(workspaces: Workspace[], id: string | null): Workspace | null {
  return workspaces.find(workspace => workspace.id === id) ?? workspaces[0] ?? null
}

export function workspaceInfo(workspace: Workspace): WorkspaceInfo {
  return { id: workspace.id, label: workspace.label, short: workspace.short ?? workspace.label }
}

function repoName(repo: string): string {
  return (repo.split('/').at(-1) ?? repo).toLowerCase()
}

// Whether a topic link (APP-12 or web#34) belongs to that workspace
export function owns(workspace: Workspace, ref: string): boolean {
  const ticket = TICKET_REF.exec(ref)
  if (ticket) return workspace.jiraProjects.includes(ticket[1])
  const pr = PR_REF.exec(ref)
  if (pr) return (workspace.github.repos ?? []).some(repo => repoName(repo) === pr[1].toLowerCase())
  return false
}

// A topic hides only when every linked ref belongs to another workspace; free notes always show
export function topicVisible(topic: Topic, active: Workspace | null, all: Workspace[]): boolean {
  if (!active) return true
  const others = all.filter(workspace => workspace.id !== active.id)
  const refs = topic.links.filter(ref => TICKET_REF.test(ref) || PR_REF.test(ref))
  if (refs.length === 0) return true
  return refs.some(ref => owns(active, ref) || !others.some(workspace => owns(workspace, ref)))
}

export interface GithubScope {
  // Search qualifiers appended to every PR search
  qualifiers: string
  // Owner used to look up PRs linked by topics
  owner: string
}

export function githubScope(workspace: Workspace | null, fallbackOwner: string): GithubScope {
  const owner = workspace?.github.owner || fallbackOwner
  const repos = workspace?.github.repos ?? []
  if (repos.length > 0) {
    const qualifiers = repos
      .map(repo => (repo.includes('/') ? repo : owner ? `${owner}/${repo}` : null))
      .filter((repo): repo is string => repo !== null)
      .map(repo => ` repo:${repo}`)
      .join('')
    if (qualifiers) return { qualifiers, owner }
  }
  return { qualifiers: owner ? ` org:${owner}` : '', owner }
}

