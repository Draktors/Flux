import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activeViews, reconcile } from '../src/main/engine/ball'
import { continueUrl } from '../src/main/threads/desktop'
import {
  desktopOf,
  parseDesktopSession,
  readDesktopSessions,
  syncThreads,
  type DesktopSession,
} from '../src/main/threads/sessions'
import type { ThreadRef, Topic } from '../src/shared/types'

const CLI = 'bbbbbbbb-1111-4222-8333-555555555555'
const MOVED = 'cccccccc-1111-4222-8333-666666666666'
const NOW = new Date('2026-11-13T10:00:00Z')

function session(overrides: Partial<DesktopSession> = {}): DesktopSession {
  return {
    id: 'local_one',
    cli: CLI,
    previous: [],
    title: 'Corriger le PDF',
    archived: false,
    activeAt: Date.parse('2026-11-13T09:00:00Z'),
    ...overrides,
  }
}

function thread(overrides: Partial<ThreadRef> = {}): ThreadRef {
  return {
    session: CLI,
    name: 'flux · APP-1',
    cwd: '/Users/me/code',
    startedAt: '2026-11-12T08:00:00Z',
    ...overrides,
  }
}

function topic(id: string, threads: ThreadRef[], status: Topic['status'] = 'open'): Topic {
  return { id, title: id, status, links: [], threads, createdAt: '2026-11-10T08:00:00Z', body: '' }
}

describe('sessions Claude Desktop', () => {
  it('lit la fiche de Desktop et ignore le reste', () => {
    expect(
      parseDesktopSession({
        sessionId: 'local_one',
        cliSessionId: CLI,
        previousCliSessionIds: [MOVED, 3],
        title: 'Corriger le PDF',
        isArchived: true,
        lastActivityAt: 1_794_500_000_000,
      }),
    ).toEqual({
      id: 'local_one',
      cli: CLI,
      previous: [MOVED],
      title: 'Corriger le PDF',
      archived: true,
      activeAt: 1_794_500_000_000,
    })
    expect(parseDesktopSession({ sessionId: 'cse_remote', cliSessionId: CLI })).toBeNull()
    expect(parseDesktopSession(null)).toBeNull()
  })

  it('trouve les fiches deux dossiers plus bas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flux-desktop-'))
    const folder = join(root, 'account', 'org')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'local_one.json'), JSON.stringify({ sessionId: 'local_one', cliSessionId: CLI }))
    await writeFile(join(folder, 'local_broken.json'), '{')
    await writeFile(join(folder, 'notes.txt'), 'rien')
    const sessions = await readDesktopSessions(root)
    expect(sessions.map(entry => entry.id)).toEqual(['local_one'])
  })

  it('rattache un thread même quand sa conversation a changé d’id', () => {
    expect(desktopOf(thread(), [session()])?.id).toBe('local_one')
    expect(desktopOf(thread(), [session({ cli: MOVED, previous: [CLI] })])?.cli).toBe(MOVED)
    expect(desktopOf(thread({ session: 'autre', desktop: 'local_one' }), [session()])?.id).toBe('local_one')
    expect(desktopOf(thread(), [session({ cli: 'autre' })])).toBeUndefined()
  })

  it('préfère la session rouverte à celle archivée', () => {
    const archived = session({ archived: true, activeAt: Date.parse('2026-11-13T09:30:00Z') })
    const reopened = session({ id: 'local_two', activeAt: Date.parse('2026-11-13T08:00:00Z') })
    expect(desktopOf(thread({ desktop: 'local_one' }), [archived, reopened])?.id).toBe('local_two')
  })

  it('enregistre l’id Desktop, le nouvel id de conversation et le titre', () => {
    const open = topic('ouvert', [thread()])
    const changed = syncThreads([open], [session({ cli: MOVED, previous: [CLI] })])
    expect(changed).toEqual([open])
    expect(open.threads[0]).toMatchObject({ desktop: 'local_one', session: MOVED, title: 'Corriger le PDF' })
    expect(syncThreads([open], [session({ cli: MOVED, previous: [CLI] })])).toEqual([])
  })

  it('laisse un thread qui démarre encore', () => {
    const waiting = topic('attente', [thread({ pending: true })])
    expect(syncThreads([waiting], [session()])).toEqual([])
  })

  it('rouvre une session Desktop par son id', () => {
    expect(continueUrl('local_one')).toBe('claude://code/continue?session=local_one')
  })
})

describe('En cours', () => {
  const live = [{ session: 'busy-cli', status: 'busy' as const }]
  const desktop = [
    session({ id: 'local_paused', cli: 'paused-cli', activeAt: Date.parse('2026-11-13T09:00:00Z') }),
    session({ id: 'local_archived', cli: 'archived-cli', archived: true, activeAt: Date.parse('2026-11-13T09:50:00Z') }),
  ]
  const topics = [
    topic('archivee', [thread({ session: 'archived-cli' })]),
    topic('en-pause', [thread({ session: 'paused-cli' })]),
    topic('au-travail', [thread({ session: 'busy-cli' })]),
    topic('demarre', [thread({ session: 'dir', pending: true })]),
    topic('sans-thread', []),
  ]

  it('dit si la session travaille, dort dans Desktop ou est archivée', () => {
    const { views } = reconcile(topics, [], live, NOW, desktop)
    const status = (id: string) => views.find(view => view.topic.id === id)?.threads[0]?.status
    expect(status('au-travail')).toBe('busy')
    expect(status('en-pause')).toBe('paused')
    expect(status('archivee')).toBe('archived')
    expect(status('demarre')).toBe('pending')
    expect(views.find(view => view.topic.id === 'en-pause')?.threads[0].title).toBe('Corriger le PDF')
  })

  it('garde chaque sujet qui a une conversation, la plus vivante d’abord', () => {
    const { views } = reconcile(topics, [], live, NOW, desktop)
    expect(activeViews(views).map(view => view.topic.id)).toEqual(['au-travail', 'en-pause', 'archivee'])
  })
})
