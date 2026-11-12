import { describe, expect, it } from 'vitest'
import { appStoreReviews, playRequest, playStoreReviews, type StoresConfig } from '../src/main/sources/stores'

const config: StoresConfig = { country: 'fr', language: 'fr', apps: [] }
const app = { name: 'Ouihelp Pro', appStore: '1367442728', playStore: 'fr.ouihelp.daca' }

const appleEntry = (id: string, rating: string) => ({
  id: { label: id },
  author: { name: { label: 'Camille' } },
  updated: { label: '2026-11-09T14:02:11-07:00' },
  title: { label: 'Bloqué' },
  content: { label: ' Impossible de valider mon passage ' },
  'im:rating': { label: rating },
  'im:version': { label: '4.2.0' },
})

describe('avis App Store', () => {
  it('lit la liste du flux RSS et écarte les entrées incomplètes', () => {
    const feed = { feed: { entry: [appleEntry('11', '2'), appleEntry('12', '0'), { id: { label: '13' } }] } }
    expect(appStoreReviews(feed, app, config)).toEqual([
      {
        id: 'app-store:11',
        app: 'Ouihelp Pro',
        store: 'app-store',
        rating: 2,
        title: 'Bloqué',
        text: 'Impossible de valider mon passage',
        author: 'Camille',
        date: '2026-11-09T21:02:11.000Z',
        version: '4.2.0',
        url: 'https://apps.apple.com/fr/app/id1367442728?see-all=reviews',
      },
    ])
  })

  it('accepte un avis seul ou aucun', () => {
    expect(appStoreReviews({ feed: { entry: appleEntry('11', '5') } }, app, config)).toHaveLength(1)
    expect(appStoreReviews({ feed: {} }, app, config)).toEqual([])
    expect(appStoreReviews(null, app, config)).toEqual([])
  })
})

describe('avis Google Play', () => {
  const row = (id: string, rating: number, text: string | null) => [
    id,
    ['Dominique', null],
    rating,
    null,
    text,
    [1762790400, 0],
    0,
    null,
    null,
    null,
    '4.2.0',
  ]

  const body = (rows: unknown[]) => {
    const call = JSON.stringify([['wrb.fr', 'UsvDTd', JSON.stringify([rows, null]), null, null, null, 'generic']])
    return `)]}'\n\n${call.length}\n${call}\n25\n[["di",42],["af.httprm",41]]\n`
  }

  it('lit les avis dans le morceau de l’appel', () => {
    const reviews = playStoreReviews(body([row('gp:1', 1, ' Plante au démarrage '), row('gp:2', 4, null), ['incomplet']]), app, config)
    expect(reviews).toEqual([
      {
        id: 'play-store:gp:1',
        app: 'Ouihelp Pro',
        store: 'play-store',
        rating: 1,
        title: null,
        text: 'Plante au démarrage',
        author: 'Dominique',
        date: '2025-11-10T16:00:00.000Z',
        version: '4.2.0',
        url: 'https://play.google.com/store/apps/details?id=fr.ouihelp.daca&hl=fr&reviewId=gp:1',
      },
    ])
  })

  it('ne rend rien sur une réponse inattendue', () => {
    expect(playStoreReviews(')]}\'\n\n12\n[["e",4]]\n', app, config)).toEqual([])
    expect(playStoreReviews('<html>', app, config)).toEqual([])
  })

  it('demande les avis les plus récents du paquet', () => {
    const request = decodeURIComponent(playRequest(app).replace(/^f\.req=/, ''))
    const [[[rpc, args]]] = JSON.parse(request) as [[[string, string]]]
    expect(rpc).toBe('UsvDTd')
    expect(JSON.parse(args)).toEqual([null, null, [2, 2, [40, null, null], null, []], ['fr.ouihelp.daca', 7]])
  })
})
