import { describe, expect, it } from 'vitest'
import { fluxLink, linkMenuEntries, parseFluxLink, sourceName } from '../src/shared/links'

describe('liens flux://', () => {
  it('écrit un lien lisible et le relit à l’identique', () => {
    const routes = [
      { kind: 'ref' as const, ref: 'daca#1553' },
      { kind: 'ref' as const, ref: 'OFF-917' },
      { kind: 'topic' as const, id: '20261110-relire-le-cadrage' },
      { kind: 'tab' as const, tab: 'waiting' as const },
      { kind: 'tab' as const, tab: 'daily' as const },
    ]
    expect(routes.map(fluxLink)).toEqual([
      'flux://ref/daca%231553',
      'flux://ref/OFF-917',
      'flux://topic/20261110-relire-le-cadrage',
      'flux://attente',
      'flux://daily',
    ])
    expect(routes.map(route => parseFluxLink(fluxLink(route)))).toEqual(routes)
  })

  it('accepte les noms d’onglet internes et la casse, refuse le reste', () => {
    expect(parseFluxLink('FLUX://Wrap-Up/')).toEqual({ kind: 'tab', tab: 'wrapup' })
    expect(parseFluxLink('flux://queue')).toEqual({ kind: 'tab', tab: 'queue' })
    expect(parseFluxLink('flux://ref/')).toBeNull()
    expect(parseFluxLink('flux://inconnu')).toBeNull()
    expect(parseFluxLink('flux://daily/en-trop')).toBeNull()
    expect(parseFluxLink('https://flux.test/ref/x')).toBeNull()
    expect(parseFluxLink('pas un lien')).toBeNull()
  })
})

describe('menu du clic droit', () => {
  it('nomme chaque source, et la ref seulement quand deux liens viennent du même outil', () => {
    expect(sourceName('https://groupe-ouihelp.ghe.com/ouihelp/daca/pull/1553')).toBe('GitHub')
    expect(sourceName('https://ouihelp.slack.com/archives/C1/p2')).toBe('Slack')
    expect(sourceName('https://acme.atlassian.net/browse/APP-1')).toBe('Jira')
    expect(sourceName('https://www.exemple.fr/page')).toBe('exemple.fr')
    expect(sourceName('obsidian://open?vault=x')).toBeNull()

    const entries = linkMenuEntries({
      sources: [
        { ref: 'daca#1553', url: 'https://github.com/acme/daca/pull/1553' },
        { ref: 'OFF-917', url: 'https://linear.app/acme/issue/OFF-917' },
        { ref: 'OFF-918', url: 'https://linear.app/acme/issue/OFF-918' },
        { ref: 'OFF-918', url: 'https://linear.app/acme/issue/OFF-918' },
        { ref: null, url: 'javascript:alert(1)' },
      ],
      flux: 'flux://ref/daca%231553',
    })
    expect(entries).toEqual([
      { label: 'Copier le lien GitHub', copy: 'https://github.com/acme/daca/pull/1553' },
      { label: 'Copier le lien Linear · OFF-917', copy: 'https://linear.app/acme/issue/OFF-917' },
      { label: 'Copier le lien Linear · OFF-918', copy: 'https://linear.app/acme/issue/OFF-918' },
      { label: 'Copier le lien dans Flux', copy: 'flux://ref/daca%231553' },
    ])
  })

  it('n’offre pas de lien Flux invalide', () => {
    expect(linkMenuEntries({ sources: [], flux: 'flux://nulle-part' })).toEqual([])
  })
})
