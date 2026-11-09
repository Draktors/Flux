import { describe, expect, it } from 'vitest'
import { isMaxSession } from '../src/main/llm/claude'
import { isDailyDue, localDate, noteFrom } from '../src/main/llm/daily'
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
    expect(noteFrom('Voici le digest.\n\n# Daily — 2026-11-06\ncorps\n\n', '2026-11-06')).toBe(
      '# Daily — 2026-11-06\ncorps\n',
    )
    expect(() => noteFrom('Je n’ai pas pu.', '2026-11-06')).toThrow()
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
