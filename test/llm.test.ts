import { describe, expect, it } from 'vitest'
import { isMaxSession } from '../src/main/llm/claude'
import { dailyFrom, isDailyDue, localDate, type DailyIds } from '../src/main/llm/daily'
import { applyVerdicts, parseVerdicts } from '../src/main/llm/triage'
import type { Ticket } from '../src/main/engine/rank'
import { displayTitle, splitTitle } from '../src/renderer/src/format'

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

  it('date la note en heure locale', () => {
    expect(localDate(at('2026-11-06T00:30:00'))).toBe('2026-11-06')
  })
})

describe('réponse du daily', () => {
  const ids: DailyIds = {
    lines: new Set(['hb#1', 'hb#2', 'web#3']),
    candidates: new Set(['hb#1', 'hb#2']),
    blockers: new Set(['web#3']),
  }
  const now = new Date(2026, 10, 10, 9, 30)
  const answer = {
    intentions: ['hb#2', 'inconnu', 'hb#2', 'hb#1'],
    titles: { 'hb#1': '  Vue   débrief ', inconnu: 'ignoré' },
    unblock: { 'web#3': 'Relancer Nicolas sur le design', 'hb#1': 'pas un bloquant' },
    health: [
      { source: 'Sentry', level: 'alert', text: '2 régressions', detail: 'Crash au login', url: 'https://sentry.io/x' },
      { source: 'Datadog', level: 'ok', text: 'RAS', detail: 'jamais affiché', url: 'javascript:alert(1)' },
      { source: 'Amplitude', level: 'superbe', text: 'niveau inventé' },
    ],
  }

  it('lit le JSON même entouré de texte ou d’un bloc de code', () => {
    const content = dailyFrom(`Voici :\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`\n`, ids, now)
    expect(content.generatedAt).toBe(now.toISOString())
    expect(content.intentions).toEqual(['hb#2', 'hb#1'])
    expect(content.titles).toEqual({ 'hb#1': 'Vue débrief' })
    expect(content.unblock).toEqual({ 'web#3': 'Relancer Nicolas sur le design' })
  })

  it('garde le détail en alerte seulement et écarte les niveaux et liens inconnus', () => {
    const { health } = dailyFrom(JSON.stringify(answer), ids, now)
    expect(health).toEqual([
      { source: 'Sentry', level: 'alert', text: '2 régressions', detail: 'Crash au login', url: 'https://sentry.io/x' },
      { source: 'Datadog', level: 'ok', text: 'RAS', detail: null, url: null },
    ])
  })

  it('échoue sans objet JSON', () => {
    expect(() => dailyFrom('Je n’ai pas pu.', ids, now)).toThrow()
    expect(() => dailyFrom('{ pas du json }', ids, now)).toThrow()
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

describe('renommer un sujet', () => {
  it('garde la ref et le type devant le texte édité', () => {
    expect(splitTitle('panneau-pocket#6260 — feat(quote): open the upgrade')).toEqual({
      prefix: 'panneau-pocket#6260 — feat(quote): ',
      text: 'Open the upgrade',
    })
    expect(splitTitle('family#221 — [BLOCKED][ACC-5367] Déconnecter').prefix).toBe('family#221 — [BLOCKED][ACC-5367] ')
  })

  it('laisse une note libre entière', () => {
    expect(splitTitle('Une note: avec deux points')).toEqual({ prefix: '', text: 'Une note: avec deux points' })
  })
})
