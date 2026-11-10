import type { Topic, TrackedProject, WorkspaceInfo } from '../shared/types'
import { CONFIG, type Workspace } from './config'

// The projects chosen in the app, or else the workspaces of config.json; settings keep it current
let current: Workspace[] = CONFIG.workspaces

export function allWorkspaces(): Workspace[] {
  return current
}

export function setWorkspaces(workspaces: Workspace[]): void {
  current = workspaces
}

// One workspace per followed project, named by its key so the switch stays short
export function workspacesFromProjects(projects: TrackedProject[]): Workspace[] {
  return projects.map(project => ({
    id: project.key.toLowerCase(),
    label: project.name || project.key,
    short: project.key,
    jiraProjects: project.tracker === 'jira' ? [project.key.toUpperCase()] : [],
    linearTeams: project.tracker === 'linear' ? [project.key.toUpperCase()] : [],
    github: { repos: project.repos, noReview: project.noReview },
  }))
}

// What the projects picker starts from before you chose anything: config.json, one project per key
export function projectsFromWorkspaces(workspaces: Workspace[]): TrackedProject[] {
  return workspaces.flatMap(workspace => {
    const owner = workspace.github.owner ?? ''
    const full = (repo: string) => (repo.includes('/') || !owner ? repo : `${owner}/${repo}`)
    const repos = (workspace.github.repos ?? []).map(full)
    const noReview = (workspace.github.noReview ?? []).map(full)
    const keys: Array<[TrackedProject['tracker'], string]> = [
      ...workspace.jiraProjects.map(key => ['jira', key] as [TrackedProject['tracker'], string]),
      ...(workspace.linearTeams ?? []).map(key => ['linear', key] as [TrackedProject['tracker'], string]),
    ]
    return keys.map(([tracker, key]) => ({
      tracker,
      key,
      name: keys.length === 1 ? workspace.label : key,
      repos,
      noReview,
    }))
  })
}

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
  if (ticket) return [...workspace.jiraProjects, ...(workspace.linearTeams ?? [])].includes(ticket[1])
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

// Whether a GitHub repo (owner/name) belongs to that workspace
export function ownsRepo(workspace: Workspace, remote: string, fallbackOwner = ''): boolean {
  const [owner, name] = remote.toLowerCase().split('/')
  const home = (workspace.github.owner || fallbackOwner).toLowerCase()
  const repos = workspace.github.repos ?? []
  if (repos.length === 0) return home !== '' && owner === home
  return repos.some(repo => {
    const [repoOwner, repoName] = repo.includes('/') ? repo.toLowerCase().split('/') : [home, repo.toLowerCase()]
    return repoName === name && (repoOwner === '' || repoOwner === owner)
  })
}
