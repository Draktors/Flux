import { describe, expect, it } from 'vitest'
import type { Workspace } from '../src/main/config'
import {
  branchTickets,
  buildDaily,
  gitLines,
  meetingLines,
  renderDailyNote,
  type DailyInput,
} from '../src/main/engine/daily'
import { gitFor, meetingsFor } from '../src/main/engine/poller'
import { emptyJournal } from '../src/main/engine/wrapup'
import { dailyFrom, workspaceScope } from '../src/main/llm/daily'
import { parseLog, remoteName, type GitActivity } from '../src/main/sources/commits'
import { ownsRepo } from '../src/main/workspaces'
import type { Topic, TopicView } from '../src/shared/types'

const PP: Workspace = {
  id: 'pp',
  label: 'PanneauPocket',
  short: 'PP',
  jiraProjects: ['DEVPP'],
  github: { owner: 'panneaupocket-jvs', repos: ['panneau-pocket-mobile'] },
}
const CC: Workspace = {
  id: 'cc',
  label: 'Communicity',
  short: 'CC',
  jiraProjects: ['CCM'],
  github: { owner: 'citopia-jvs', repos: ['cc-mobile'] },
}

const NOW = new Date(2026, 10, 10, 9, 30)

const commit = (remote: string | null, ref: string, subject: string, hour: number) => ({
  repo: remote?.split('/')[1] ?? 'perso',
  remote,
  ref,
  sha: String(hour),
  at: new Date(2026, 10, 9, hour).toISOString(),
  subject,
})

const git: GitActivity = {
  commits: [
    commit('panneaupocket-jvs/panneau-pocket-mobile', 'refs/heads/feat/DEVPP-1987-alerts', 'feat: bottom sheet', 10),
    commit('panneaupocket-jvs/panneau-pocket-mobile', 'refs/heads/feat/DEVPP-1987-alerts', 'fix: zoom', 15),
    commit('citopia-jvs/cc-mobile', 'refs/heads/feature/CCM-11_sms', 'fix(sms): dark mode', 11),
    commit('Draktors/portfolio', 'refs/heads/main', 'feat: mascot', 12),
  ],
  uncommitted: [
    { repo: 'communicity', remote: 'citopia-jvs/cc-mobile', branch: 'feature/CCM-11_sms', files: ['app.json'] },
  ],
}

function input(overrides: Partial<DailyInput>): DailyInput {
  const today = emptyJournal('2026-11-10')
  return {
    now: NOW,
    journals: [today],
    today,
    topics: [],
    views: [],
    queue: [],
    active: [],
    merged: [],
    fallback: null,
    reviews: null,
    run: { date: '2026-11-10', status: 'none' },
    skill: 'ready',
    dailyTime: '09:30',
    notePath: null,
    ...overrides,
  }
}

describe('commits et remotes', () => {
  it('lit owner/name d’un remote ssh ou https', () => {
    expect(remoteName('git@github-citopia:citopia-jvs/cc-mobile.git')).toBe('citopia-jvs/cc-mobile')
    expect(remoteName('github-citopia:panneaupocket-jvs/panneau-pocket-sag.git')).toBe(
      'panneaupocket-jvs/panneau-pocket-sag',
    )
    expect(remoteName('https://github.com/Draktors/Flux.git')).toBe('Draktors/Flux')
    expect(remoteName('')).toBeNull()
  })

  it('lit le journal git, même avec un séparateur dans le message', () => {
    const line = ['abcdef1234567', '2026-11-06T17:02:00+01:00', 'refs/heads/feat/sms', 'fix: a\x1fb'].join('\x1f')
    expect(parseLog(`${line}\n`, 'cc-mobile', 'citopia-jvs/cc-mobile')).toEqual([
      {
        repo: 'cc-mobile',
        remote: 'citopia-jvs/cc-mobile',
        ref: 'refs/heads/feat/sms',
        sha: 'abcdef1234',
        at: '2026-11-06T17:02:00+01:00',
        subject: 'fix: a\x1fb',
      },
    ])
  })

  it('rattache un dépôt à son espace', () => {
    expect(ownsRepo(PP, 'panneaupocket-jvs/panneau-pocket-mobile')).toBe(true)
    expect(ownsRepo(PP, 'citopia-jvs/cc-mobile')).toBe(false)
    expect(ownsRepo({ ...CC, github: { owner: 'citopia-jvs' } }, 'citopia-jvs/anything')).toBe(true)
  })
})

describe('daily par espace', () => {
  it('ne garde que les dépôts de l’espace, et aucun dépôt perso', () => {
    const pp = gitFor(git, PP)
    expect(pp?.commits.map(entry => entry.subject)).toEqual(['feat: bottom sheet', 'fix: zoom'])
    expect(pp?.uncommitted).toEqual([])
    expect(gitFor(git, CC)?.uncommitted).toHaveLength(1)
    expect(gitFor(git, null)).toBe(git)
  })

  it('écarte les réunions d’un autre espace et garde celles sans espace', () => {
    const meetings = [
      { title: 'PP - Daily', start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T09:15:00.000Z' },
      { title: 'CC - Daily', start: '2026-11-09T10:00:00.000Z', end: '2026-11-09T10:15:00.000Z' },
      { title: 'Point RH', start: '2026-11-09T11:00:00.000Z', end: '2026-11-09T11:30:00.000Z' },
    ]
    expect(meetingsFor(meetings, PP, [PP, CC]).map(meeting => meeting.title)).toEqual(['PP - Daily', 'Point RH'])
  })

  it('dit pour quel espace est le daily, sans citer les autres', () => {
    const scope = workspaceScope({ workspace: 'pp' }, [PP, CC])
    expect(scope).toContain('PanneauPocket (PP)')
    expect(scope).toContain('Rien de Communicity (CC)')
    expect(workspaceScope({ workspace: null }, [PP, CC])).toBe('')
  })

  it('ne montre que les intentions de l’espace affiché', () => {
    const topic = (id: string, links: string[]): Topic => ({
      id,
      title: id,
      status: 'open',
      links,
      threads: [],
      createdAt: NOW.toISOString(),
      body: '',
    })
    const pp = topic('pp-1', ['DEVPP-1'])
    const cc = topic('cc-1', ['CCM-1'])
    const today = { ...emptyJournal('2026-11-10'), intentions: ['cc-1', 'pp-1'] }
    const sheet = buildDaily(
      input({
        today,
        journals: [today],
        topics: [pp, cc],
        visible: entry => entry.links.some(link => link.startsWith('DEVPP')),
        views: [] as TopicView[],
      }),
    )
    expect(sheet.intentions.map(line => line.id)).toEqual(['pp-1'])
  })
})

describe('hier : commits, travail en cours et réunions', () => {
  it('lit le ticket d’une branche, même collé à la suite', () => {
    expect(branchTickets('feature/CCM-11_compteur_sms', ['CCM'])).toEqual(['CCM-11'])
    expect(branchTickets('feat/devpp-1987-redesign-step-2', ['DEVPP'])).toEqual(['DEVPP-1987'])
    expect(branchTickets('feat/redesign-step-2', ['DEVPP'])).toEqual([])
  })

  it('fait une ligne par branche, nommée par son ticket', () => {
    const lines = gitLines({ git: gitFor(git, PP), now: NOW, ticketPrefixes: ['DEVPP'] }, {}, new Map())
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      kind: 'pushed',
      title: 'DEVPP-1987 — fix: zoom',
      note: '2 commits sur feat/DEVPP-1987-alerts',
      refs: [{ ref: 'DEVPP-1987', url: null }],
    })
  })

  it('ne prend pas un stash pour une branche poussée', () => {
    const stash = { commits: [commit('panneaupocket-jvs/panneau-pocket-mobile', 'refs/stash', 'WIP on develop', 9)], uncommitted: [] }
    expect(gitLines({ git: stash, now: NOW, ticketPrefixes: ['DEVPP'] }, {}, new Map())).toEqual([])
  })

  it('ne répète pas une branche dont le ticket a déjà sa ligne, mais garde le travail en cours', () => {
    const lines = gitLines({ git: gitFor(git, CC), now: NOW, ticketPrefixes: ['CCM'] }, {}, new Map(), new Set(['CCM-11']))
    expect(lines.map(line => line.kind)).toEqual(['wip'])
    expect(lines[0].note).toBe('1 fichier pas encore poussé, dans communicity')
  })

  it('met sous chaque réunion ce que le skill en a retenu', () => {
    const start = '2026-11-09T09:00:00.000Z'
    const lines = meetingLines(
      {
        meetings: [{ title: 'PP - Daily', start, end: start }],
        run: {
          date: '2026-11-10',
          status: 'ready',
          content: {
            generatedAt: NOW.toISOString(),
            intentions: [],
            titles: {},
            unblock: {},
            health: [],
            meetings: { [`meeting:${start}`]: 'On livre la refonte jeudi' },
          },
        },
      },
      {},
    )
    expect(lines[0]).toMatchObject({ kind: 'meeting', title: 'PP - Daily', note: 'On livre la refonte jeudi' })
  })

  it('lit le stand-up et les réunions de la réponse, et rien d’inconnu', () => {
    const ids = { lines: new Set(['meeting:a', 'x']), candidates: new Set<string>(), blockers: new Set<string>() }
    const content = dailyFrom(
      JSON.stringify({
        intentions: [],
        titles: {},
        unblock: {},
        health: [],
        meetings: { 'meeting:a': 'Décision prise', 'meeting:z': 'Inconnue', x: 'Pas une réunion' },
        standup: '  Hier j’ai fini la refonte.   Aujourd’hui je livre.  ',
      }),
      ids,
      NOW,
    )
    expect(content.meetings).toEqual({ 'meeting:a': 'Décision prise' })
    expect(content.standup).toBe('Hier j’ai fini la refonte. Aujourd’hui je livre.')
  })

  it('met le stand-up et les notes dans la note du vault', () => {
    const sheet = buildDaily(
      input({
        git: gitFor(git, PP),
        ticketPrefixes: ['DEVPP'],
        run: {
          date: '2026-11-10',
          status: 'ready',
          content: {
            generatedAt: NOW.toISOString(),
            intentions: [],
            titles: {},
            unblock: {},
            health: [],
            standup: 'Hier j’ai avancé la refonte.',
          },
        },
      }),
    )
    const note = renderDailyNote(sheet, NOW)
    expect(note).toContain('> Hier j’ai avancé la refonte.')
    expect(note).toContain('- Poussé · fix: zoom (DEVPP-1987) — 2 commits sur feat/DEVPP-1987-alerts')
  })
})
