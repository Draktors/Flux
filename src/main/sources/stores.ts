import type { Store, StoreFeed, StoreReview } from '../../shared/types'

// The apps whose reviews the daily shows, with their id on each store
export interface StoreApp {
  name: string
  // Numeric App Store id
  appStore?: string
  // Android package name
  playStore?: string
}

export interface StoresConfig {
  country: string
  language: string
  apps: StoreApp[]
}

const TIMEOUT_MS = 15_000
// The newest reviews are enough: the daily only keeps those of the last workday or two
const PLAY_COUNT = 40
const PLAY_RPC = 'UsvDTd'
const PLAY_NEWEST = 2

type Label = { label?: unknown }

interface AppleEntry {
  id?: Label
  author?: { name?: Label }
  updated?: Label
  title?: Label
  content?: Label
  'im:rating'?: Label
  'im:version'?: Label
}

function label(field: Label | undefined): string | null {
  return typeof field?.label === 'string' && field.label.trim() ? field.label.trim() : null
}

// The App Store RSS feed: entry is missing without reviews, an object with one
export function appStoreReviews(feed: unknown, app: StoreApp, config: StoresConfig): StoreReview[] {
  const raw = (feed as { feed?: { entry?: AppleEntry | AppleEntry[] } })?.feed?.entry
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : []
  const url = `https://apps.apple.com/${config.country}/app/id${app.appStore}?see-all=reviews`
  return entries.flatMap(entry => {
    const id = label(entry.id)
    const rating = Number(label(entry['im:rating']))
    const date = label(entry.updated)
    const text = label(entry.content)
    if (!id || !date || !text || !(rating >= 1 && rating <= 5)) return []
    return [
      {
        id: `app-store:${id}`,
        app: app.name,
        store: 'app-store' as const,
        rating,
        title: label(entry.title),
        text,
        author: label(entry.author?.name) ?? 'Anonyme',
        date: new Date(date).toISOString(),
        version: label(entry['im:version']),
        url,
      },
    ]
  })
}

export function playRequest(app: StoreApp): string {
  const args = JSON.stringify([null, null, [2, PLAY_NEWEST, [PLAY_COUNT, null, null], null, []], [app.playStore, 7]])
  return `f.req=${encodeURIComponent(JSON.stringify([[[PLAY_RPC, args, null, 'generic']]]))}`
}

// Google Play answers in length-prefixed chunks; the reviews sit, as JSON in a string, in the chunk of the call
export function playStoreReviews(body: string, app: StoreApp, config: StoresConfig): StoreReview[] {
  let payload: unknown = null
  for (const line of body.split('\n')) {
    if (!line.startsWith('[')) continue
    try {
      const chunk = JSON.parse(line) as unknown[][]
      const call = chunk.find(part => part[0] === 'wrb.fr' && part[1] === PLAY_RPC)
      if (call && typeof call[2] === 'string') payload = JSON.parse(call[2])
    } catch {
      continue
    }
  }
  const rows = (payload as unknown[][] | null)?.[0]
  if (!Array.isArray(rows)) return []
  return rows.flatMap(row => {
    if (!Array.isArray(row)) return []
    const [id, author, rating, , text, posted] = row as [unknown, unknown, unknown, unknown, unknown, unknown]
    const seconds = Array.isArray(posted) ? Number(posted[0]) : NaN
    if (typeof id !== 'string' || typeof text !== 'string' || !text.trim() || !Number.isFinite(seconds)) return []
    if (typeof rating !== 'number' || rating < 1 || rating > 5) return []
    const name = Array.isArray(author) && typeof author[0] === 'string' ? author[0] : 'Anonyme'
    const version = typeof row[10] === 'string' ? row[10] : null
    return [
      {
        id: `play-store:${id}`,
        app: app.name,
        store: 'play-store' as const,
        rating,
        title: null,
        text: text.trim(),
        author: name,
        date: new Date(seconds * 1000).toISOString(),
        version,
        url: `https://play.google.com/store/apps/details?id=${app.playStore}&hl=${config.language}&reviewId=${id}`,
      },
    ]
  })
}

async function fromAppStore(app: StoreApp, config: StoresConfig): Promise<StoreReview[]> {
  const url = `https://itunes.apple.com/${config.country}/rss/customerreviews/page=1/id=${app.appStore}/sortby=mostrecent/json`
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`App Store ${response.status}`)
  return appStoreReviews(await response.json(), app, config)
}

async function fromPlayStore(app: StoreApp, config: StoresConfig): Promise<StoreReview[]> {
  const query = new URLSearchParams({ rpcids: PLAY_RPC, hl: config.language, gl: config.country, rt: 'c' })
  const response = await fetch(`https://play.google.com/_/PlayStoreUi/data/batchexecute?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: playRequest(app),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Google Play ${response.status}`)
  return playStoreReviews(await response.text(), app, config)
}

// Every app on every store it is on; a store that does not answer is named, the others still count
export async function fetchStoreReviews(config: StoresConfig): Promise<StoreFeed> {
  const calls: Array<{ app: string; store: Store; read: Promise<StoreReview[]> }> = []
  for (const app of config.apps) {
    if (app.appStore) calls.push({ app: app.name, store: 'app-store', read: fromAppStore(app, config) })
    if (app.playStore) calls.push({ app: app.name, store: 'play-store', read: fromPlayStore(app, config) })
  }
  const results = await Promise.allSettled(calls.map(call => call.read))
  const feed: StoreFeed = { reviews: [], failed: [] }
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') feed.reviews.push(...result.value)
    else feed.failed.push({ app: calls[index].app, store: calls[index].store })
  })
  return feed
}
