import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Item, ProposedAction, ThreadRef, TopicView } from '../../shared/types'
import { run } from '../exec'
import { BIN, REPOS_DIR, THREADS_DIR, TOPICS_DIR } from '../paths'
import { renderBrief, threadName, threadPrompt } from './brief'
import { repoFromRef } from './actions'
import { selectWorkspace } from './cmux'
import { newSessionUrl, openInDesktop, resumeUrl } from './desktop'

const SESSION_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function parseWorktrees(porcelain: string): Map<string, string> {
  const byBranch = new Map<string, string>()
  for (const block of porcelain.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
    if (path && branch) byBranch.set(branch, path)
  }
  return byBranch
}

export async function resolveCwd(items: Item[]): Promise<string> {
  for (const item of items) {
    const repo = repoFromRef(item.ref)
    if (!repo) continue
    const root = join(REPOS_DIR, repo)
    if (!existsSync(root)) continue
    const porcelain = await run(BIN.git, ['-C', root, 'worktree', 'list', '--porcelain']).catch(
      () => '',
    )
    return (item.branch && parseWorktrees(porcelain).get(item.branch)) || root
  }
  return REPOS_DIR
}

export async function launchThread(view: TopicView, action: ProposedAction): Promise<ThreadRef> {
  const id = randomUUID()
  const dir = join(THREADS_DIR, id)
  const brief = join(dir, 'brief.md')
  const name = threadName(view)
  const cwd = await resolveCwd(view.items)
  const prompt = threadPrompt(action, brief)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(brief, renderBrief(view, join(TOPICS_DIR, `${view.topic.id}.md`)))
  await writeFile(join(dir, 'prompt'), prompt)
  await writeFile(join(dir, 'name'), name)
  await writeFile(join(dir, 'cwd'), cwd)
  await openInDesktop(newSessionUrl(prompt, [cwd, dir]))
  return { session: id, dir: id, name, cwd, startedAt: new Date().toISOString(), pending: true }
}

export async function goToThread(thread: ThreadRef, alive: boolean): Promise<string | undefined> {
  if (thread.pending) {
    // Desktop never wrote a transcript for it: start the same prompt again
    const dir = join(THREADS_DIR, thread.dir ?? thread.session)
    const prompt = await readFile(join(dir, 'prompt'), 'utf8')
    await openInDesktop(newSessionUrl(prompt, [thread.cwd, dir]))
    return undefined
  }
  if (!SESSION_ID.test(thread.session)) throw new Error(`Session invalide : ${thread.session}`)
  // A thread still running in a cmux tab cannot move: bring the tab forward
  if (alive && thread.workspace && (await selectWorkspace(thread.workspace))) {
    return thread.workspace
  }
  await openInDesktop(resumeUrl(thread.session))
  return undefined
}
