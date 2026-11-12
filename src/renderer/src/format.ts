const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function waitingFor(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const elapsed = now - new Date(iso).getTime()
  if (elapsed < HOUR) return `${Math.max(1, Math.round(elapsed / MINUTE))} min`
  if (elapsed < DAY) return `${Math.round(elapsed / HOUR)} h`
  return `${Math.round(elapsed / DAY)} j`
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function until(iso: string, now = Date.now()): string {
  const remaining = new Date(iso).getTime() - now
  if (remaining < HOUR) return `dans ${Math.max(1, Math.round(remaining / MINUTE))} min`
  return `à ${clock(iso)}`
}

// The ref, ticket tags and commit type a title carries, apart from what it says:
// renaming edits the text and keeps the prefix, which ties the topic to its source
export function splitTitle(title: string): { prefix: string; text: string } {
  const plain = title
    .replace(/^(?:[a-z0-9_-]+#\d+|[A-Z]{2,5}-\d+) — /, '')
    .replace(/^(?:\[[^\]]+\]\s*)+/, '')
    .replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/, '')
  if (!plain) return { prefix: '', text: title }
  return { prefix: title.slice(0, title.length - plain.length), text: `${plain.charAt(0).toUpperCase()}${plain.slice(1)}` }
}

export function displayTitle(title: string): string {
  return splitTitle(title).text
}

export { markedBlocked } from '../../shared/titles'
