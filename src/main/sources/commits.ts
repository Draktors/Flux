import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../exec'
import { BIN } from '../paths'

export interface Commit {
  repo: string
  // GitHub owner/name of origin, e.g. citopia-jvs/cc-mobile; null without a GitHub remote
  remote: string | null
  // Ref the commit was reached from, e.g. refs/heads/feat/sms
  ref: string
  sha: string
  at: string
  subject: string
}

export interface UncommittedWork {
  repo: string
  remote: string | null
  branch: string
  files: string[]
}

export interface GitActivity {
  commits: Commit[]
  uncommitted: UncommittedWork[]
}

const FIELD = '\x1f'
const MAX_FILES = 15

// Git clones directly under root or one level deeper (root/product/repo)
export function findRepos(root: string): string[] {
  if (!existsSync(root)) return []
  const repos: string[] = []
  const visit = (dir: string, depth: number) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (existsSync(join(path, '.git'))) repos.push(path)
      else if (depth < 2) visit(path, depth + 1)
    }
  }
  visit(root, 1)
  return repos.sort()
}

// owner/name from an https or ssh remote URL
export function remoteName(url: string): string | null {
  const match = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  return match ? match[1] : null
}

export function parseLog(output: string, repo: string, remote: string | null = null): Commit[] {
  return output
    .split('\n')
    .filter(line => line.includes(FIELD))
    .map(line => {
      const [sha, at, ref, ...subject] = line.split(FIELD)
      return { repo, remote, ref, sha: sha.slice(0, 10), at, subject: subject.join(FIELD) }
    })
}

function git(repo: string, args: string[]): Promise<string> {
  return run(BIN.git, ['-C', repo, ...args], { timeoutMs: 15_000 })
}

async function authors(repo: string): Promise<string[]> {
  const local = await git(repo, ['config', '--get-all', 'user.email']).catch(() => '')
  return local.split('\n').map(email => email.trim()).filter(Boolean)
}

async function commitsOf(
  repo: string,
  name: string,
  remote: string | null,
  since: Date,
  emails: string[],
): Promise<Commit[]> {
  const output = await git(repo, [
    'log',
    // A stash is work set aside, not pushed: it would read as a branch
    '--exclude=refs/stash',
    '--all',
    '--no-merges',
    '--source',
    `--since=${since.toISOString()}`,
    ...emails.map(email => `--author=${email}`),
    `--format=%H${FIELD}%aI${FIELD}%S${FIELD}%s`,
  ])
  return parseLog(output, name, remote)
}

// Files changed but not committed, only when you touched them since `since`
async function uncommittedOf(
  repo: string,
  name: string,
  remote: string | null,
  since: Date,
): Promise<UncommittedWork | null> {
  const status = await git(repo, ['status', '--porcelain', '--untracked-files=all'])
  const files = status
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).split(' -> ').pop() ?? '')
  const recent = files.some(file => {
    try {
      return statSync(join(repo, file)).mtime >= since
    } catch {
      return true
    }
  })
  if (files.length === 0 || !recent) return null
  const branch = (await git(repo, ['branch', '--show-current']).catch(() => '')).trim()
  return { repo: name, remote, branch, files: files.slice(0, MAX_FILES) }
}

// Your commits and work in progress across every clone under root
export async function fetchGitActivity(root: string, since: Date): Promise<GitActivity> {
  const globalEmail = (await run(BIN.git, ['config', '--global', 'user.email']).catch(() => '')).trim()
  const results = await Promise.all(
    findRepos(root).map(async repo => {
      const name = repo.slice(root.length + 1)
      const emails = [...new Set([globalEmail, ...(await authors(repo))].filter(Boolean))]
      const remote = remoteName(await git(repo, ['remote', 'get-url', 'origin']).catch(() => ''))
      const [commits, uncommitted] = await Promise.all([
        emails.length > 0 ? commitsOf(repo, name, remote, since, emails).catch(() => []) : [],
        uncommittedOf(repo, name, remote, since).catch(() => null),
      ])
      return { commits, uncommitted }
    }),
  )
  return {
    commits: results.flatMap(result => result.commits).sort((a, b) => a.at.localeCompare(b.at)),
    uncommitted: results.flatMap(result => (result.uncommitted ? [result.uncommitted] : [])),
  }
}
