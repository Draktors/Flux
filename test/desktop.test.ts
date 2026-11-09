import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Topic } from '../src/shared/types'
import {
  adoptThreads,
  briefMarker,
  findSession,
  newSessionUrl,
  resumeUrl,
} from '../src/main/threads/desktop'

const THREADS = '/Users/me/.flux/threads'
const DIR = 'aaaaaaaa-1111-4222-8333-444444444444'
const SESSION = 'bbbbbbbb-1111-4222-8333-555555555555'
const STARTED = Date.parse('2026-11-08T10:00:00Z')

function topic(): Topic {
  return {
    id: '20261108-mobile-1596',
    title: 'mobile#1596',
    status: 'open',
    links: ['mobile#1596'],
    threads: [
      {
        session: DIR,
        dir: DIR,
        name: 'flux · mobile#1596',
        cwd: '/Users/me/code/mobile',
        startedAt: new Date(STARTED).toISOString(),
        pending: true,
      },
    ],
    createdAt: '2026-11-08T09:00:00Z',
    body: '',
  }
}

async function transcript(root: string, project: string, session: string, firstPrompt: string) {
  const directory = join(root, project)
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${session}.jsonl`)
  await writeFile(path, `${JSON.stringify({ type: 'user', message: { content: firstPrompt } })}\n`)
  const at = new Date(STARTED + 30_000)
  await utimes(path, at, at)
  await utimes(directory, at, at)
}

describe('deep links Claude Desktop', () => {
  it('pré-remplit le prompt et ouvre les dossiers du thread', () => {
    const url = new URL(newSessionUrl('/review-comments https://x/pull/1\n\nContexte', ['/a b', '/c']))
    expect(url.protocol).toBe('claude:')
    expect(url.host).toBe('code')
    expect(url.pathname).toBe('/new')
    expect(url.searchParams.get('q')).toBe('/review-comments https://x/pull/1\n\nContexte')
    expect(url.searchParams.getAll('folder')).toEqual(['/a b', '/c'])
  })

  it('reprend une session par son id', () => {
    expect(resumeUrl(SESSION)).toBe(`claude://resume?session=${SESSION}`)
  })
})

describe('rattachement des threads ouverts dans Desktop', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'flux-projects-'))
  })

  it('retrouve la session dont le premier message cite le brief', async () => {
    await transcript(root, '-Users-me-other', 'cccccccc-1111-4222-8333-666666666666', 'autre chose')
    await transcript(root, '-Users-me-code-mobile', SESSION, `Contexte : ${THREADS}/${DIR}/brief.md`)
    expect(await findSession(briefMarker(join(THREADS, DIR)), STARTED, root)).toBe(SESSION)
  })

  it('ignore les transcripts antérieurs au lancement', async () => {
    await transcript(root, '-Users-me-code-mobile', SESSION, `${THREADS}/${DIR}/brief.md`)
    expect(await findSession(briefMarker(join(THREADS, DIR)), STARTED + 3_600_000, root)).toBeUndefined()
  })

  it('remplace l’id provisoire par celui de la session et lève le statut en attente', async () => {
    await transcript(root, '-Users-me-code-mobile', SESSION, `${THREADS}/${DIR}/brief.md`)
    const current = topic()
    const changed = await adoptThreads([current], THREADS, STARTED + 60_000, root)
    expect(changed).toEqual([current])
    expect(current.threads[0]).toMatchObject({ session: SESSION, dir: DIR, pending: undefined })
  })

  it('laisse le thread en attente tant que le message n’est pas envoyé', async () => {
    const current = topic()
    expect(await adoptThreads([current], THREADS, STARTED + 60_000, root)).toEqual([])
    expect(current.threads[0].pending).toBe(true)
  })
})
