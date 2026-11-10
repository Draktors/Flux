import { describe, expect, it } from 'vitest'
import { isMaxSession } from '../src/main/llm/claude'
import {
  activityFor,
  heading,
  isDailyDue,
  localDate,
  localIso,
  noteFrom,
  previousWorkdayStart,
  withoutFrontmatter,
} from '../src/main/llm/daily'
import { parseLog, remoteName } from '../src/main/sources/commits'
import { ownsRepo } from '../src/main/workspaces'
import type { Workspace } from '../src/main/config'
import { applyVerdicts, parseVerdicts } from '../src/main/llm/triage'
import type { Ticket } from '../src/main/engine/rank'
import { displayTitle } from '../src/renderer/src/format'

describe('session Claude', () => {
  const max = {
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    subscriptionType: 'max',
  }

  it('accepte uniquement la session Max', () => {
    expect(isMaxSession(max)).toBe(true)
  })

  it.each([
    { ...max, loggedIn: false },
    { ...max, authMethod: 'api_key' },
    { ...max, apiProvider: 'bedrock' },
    { ...max, subscriptionType: 'pro' },
    {},
  ])('refuse %j', status => {
    expect(isMaxSession(status)).toBe(false)
  })
})

describe('verdicts de triage', () => {
  it('lit un tableau même entouré de texte ou d’un bloc de code', () => {
    const verdicts = parseVerdicts(
      '```json\n[{"id":"c1","waitingOnMe":true,"summary":"Camille attend une date"}]\n```',
    )
    expect(verdicts.c1).toEqual({ waitingOnMe: true, summary: 'Camille attend une date' })
  })

  it('ignore les entrées mal formées', () => {
    const verdicts = parseVerdicts('[{"id":"c1"},{"waitingOnMe":true},{"id":"c2","waitingOnMe":false}]')
    expect(Object.keys(verdicts)).toEqual(['c2'])
  })

  it('renvoie rien sans tableau', () => {
    expect(parseVerdicts('Je ne peux pas répondre.')).toEqual({})
  })

  it('applique le verdict et laisse visible un commentaire non trié', () => {
    const notice = (id: string) => ({
      id,
      kind: 'mention' as const,
      author: 'camille.martin',
      excerpt: 'extrait',
      text: 'texte',
      at: '2026-11-05T17:25:30Z',
      url: 'https://linear.test',
    })
    const ticket = { notices: [notice('c1'), notice('c2')] } as unknown as Ticket
    applyVerdicts([ticket], { c1: { waitingOnMe: false, summary: 'Simple information' } })
    expect(ticket.notices[0]).toMatchObject({ waitingOnMe: false, excerpt: 'Simple information' })
    expect(ticket.notices[1].waitingOnMe).toBeUndefined()
  })
})

describe('déclenchement du daily', () => {
  const at = (iso: string) => new Date(iso)

  it('part à l’heure réglée, un jour ouvré, sans note du jour', () => {
    expect(isDailyDue(at('2026-11-06T08:45:00'), '08:45', 19, false)).toBe(true)
    expect(isDailyDue(at('2026-11-06T08:44:00'), '08:45', 19, false)).toBe(false)
  })

  it('rattrape au réveil dans la journée, pas après les horaires', () => {
    expect(isDailyDue(at('2026-11-06T10:30:00'), '08:45', 19, false)).toBe(true)
    expect(isDailyDue(at('2026-11-06T19:10:00'), '08:45', 19, false)).toBe(false)
  })

  it('ne repart pas si la note existe, ni le week-end', () => {
    expect(isDailyDue(at('2026-11-06T09:00:00'), '08:45', 19, true)).toBe(false)
    expect(isDailyDue(at('2026-11-07T09:00:00'), '08:45', 19, false)).toBe(false)
  })

  it('écarte le préambule de la réponse et exige le titre du jour', () => {
    expect(noteFrom('Voici le digest.\n\n# Daily — 2026-11-06\ncorps\n\n', heading(null, '2026-11-06'))).toBe(
      '# Daily — 2026-11-06\ncorps\n',
    )
    expect(() => noteFrom('Je n’ai pas pu.', heading(null, '2026-11-06'))).toThrow()
  })

  it('date la note en heure locale', () => {
    expect(localDate(at('2026-11-06T00:30:00'))).toBe('2026-11-06')
  })
})

describe('titres affichés', () => {
  it.each([
    ['mobile#1592 — feat(report): ajouter la vue débrief', 'Ajouter la vue débrief'],
    ['family#221 — [BLOCKED][ACC-5367] Déconnecter un compte', 'Déconnecter un compte'],
    ['web#6983 — [APP-1005] Écran du recueil', 'Écran du recueil'],
    ['WEB-3434 — Volume saturé', 'Volume saturé'],
    ['Une note: avec deux points', 'Une note: avec deux points'],
  ])('%s', (raw, expected) => {
    expect(displayTitle(raw)).toBe(expected)
  })
})

describe('matière du daily', () => {
  it('remonte au vendredi un lundi', () => {
    const start = previousWorkdayStart(new Date(2026, 10, 9, 10, 0))
    expect([start.getDate(), start.getHours()]).toEqual([6, 0])
  })

  it('prend la veille un mardi', () => {
    expect(previousWorkdayStart(new Date(2026, 10, 10, 10, 0)).getDate()).toBe(9)
  })

  it('retire le frontmatter d’un skill', () => {
    expect(withoutFrontmatter('---\nname: daily\n---\n\n# Daily\n')).toBe('# Daily\n')
    expect(withoutFrontmatter('# Daily\n')).toBe('# Daily\n')
  })

  it('lit le journal git, même avec un séparateur dans le message', () => {
    const line = ['abcdef1234567', '2026-11-06T17:02:00+01:00', 'refs/heads/feat/sms', 'fix(sms): a\x1fb'].join('\x1f')
    expect(parseLog(`${line}\n`, 'cc-mobile')).toEqual([
      {
        repo: 'cc-mobile',
        remote: null,
        ref: 'refs/heads/feat/sms',
        sha: 'abcdef1234',
        at: '2026-11-06T17:02:00+01:00',
        subject: 'fix(sms): a\x1fb',
      },
    ])
  })
})

describe('heures du daily', () => {
  it('donne l’heure locale avec son décalage', () => {
    const iso = '2026-11-10T09:00:00.000Z'
    const local = localIso(iso)
    expect(new Date(local).toISOString()).toBe(iso)
    expect(local).toMatch(/^2026-11-10T\d{2}:00[+-]\d{2}:\d{2}$/)
  })
})

describe('daily par espace', () => {
  const pp: Workspace = {
    id: 'pp',
    label: 'PanneauPocket',
    short: 'PP',
    jiraProjects: ['DEVPP'],
    github: { owner: 'panneaupocket-jvs', repos: ['panneau-pocket', 'panneau-pocket-mobile'] },
  }
  const cc: Workspace = {
    id: 'cc',
    label: 'Communicity',
    short: 'CC',
    jiraProjects: ['CCM'],
    github: { owner: 'citopia-jvs', repos: ['cc-mobile'] },
  }
  const commit = (remote: string | null) => ({ repo: 'r', remote, ref: 'main', sha: '1', at: '', subject: 's' })
  const meeting = (title: string) => ({ title, start: '2026-11-06T10:00+01:00', end: '2026-11-06T10:15+01:00' })

  it('lit owner/name d’un remote ssh ou https', () => {
    expect(remoteName('git@github-citopia:citopia-jvs/cc-mobile.git')).toBe('citopia-jvs/cc-mobile')
    expect(remoteName('github-citopia:panneaupocket-jvs/panneau-pocket-sag.git')).toBe('panneaupocket-jvs/panneau-pocket-sag')
    expect(remoteName('https://github.com/Draktors/Flux.git')).toBe('Draktors/Flux')
    expect(remoteName('')).toBeNull()
  })

  it('rattache un dépôt à son espace', () => {
    expect(ownsRepo(pp, 'panneaupocket-jvs/panneau-pocket-mobile')).toBe(true)
    expect(ownsRepo(pp, 'citopia-jvs/cc-mobile')).toBe(false)
    expect(ownsRepo(pp, 'Draktors/panneau-pocket')).toBe(false)
    expect(ownsRepo({ ...cc, github: { owner: 'citopia-jvs' } }, 'citopia-jvs/anything')).toBe(true)
  })

  it('ne montre au daily PP que PP, et garde les réunions sans espace à part', () => {
    const activity = {
      since: '',
      git: {
        commits: [commit('panneaupocket-jvs/panneau-pocket-mobile'), commit('citopia-jvs/cc-mobile'), commit(null)],
        uncommitted: [{ repo: 'communicity', remote: 'citopia-jvs/cc-mobile', branch: 'b', files: [] }],
      },
      pastMeetings: [meeting('PP - Daily'), meeting('CC - Daily'), meeting('Point RH')],
      remainingMeetingsToday: [meeting('PP - Sprint Review & Sprint Retro')],
    }
    const scoped = activityFor(activity, pp, [pp, cc])
    expect(scoped.git.commits.map(c => c.remote)).toEqual(['panneaupocket-jvs/panneau-pocket-mobile'])
    expect(scoped.git.uncommitted).toEqual([])
    expect(scoped.pastMeetings?.map(m => m.title)).toEqual(['PP - Daily'])
    expect(scoped.remainingMeetingsToday?.map(m => m.title)).toEqual(['PP - Sprint Review & Sprint Retro'])
    expect(scoped.unsortedMeetings.map(m => m.title)).toEqual(['Point RH'])
  })

  it('titre la note avec l’espace', () => {
    expect(heading(pp, '2026-11-09')).toBe('# Daily PP — 2026-11-09')
    expect(heading(null, '2026-11-09')).toBe('# Daily — 2026-11-09')
  })
})
