import IcalExpander from 'ical-expander'
import type { Meeting } from '../../shared/types'

const LOOK_BACK_MS = 8 * 3_600_000
const LOOK_AHEAD_MS = 24 * 3_600_000

type Expansion = ReturnType<IcalExpander['between']>
type CalendarEvent = Expansion['events'][number]

function ownerOf(ics: string): string | null {
  return /^X-WR-CALNAME:(.+)$/m.exec(ics)?.[1]?.trim().toLowerCase() ?? null
}

interface Attendee {
  getFirstValue(): unknown
  getParameter(name: string): unknown
}

function declinedBy(event: CalendarEvent, owner: string | null): boolean {
  if (!owner) return false
  return event.attendees.some(
    (attendee: Attendee) =>
      String(attendee.getFirstValue()).toLowerCase() === `mailto:${owner}` &&
      attendee.getParameter('partstat') === 'DECLINED',
  )
}

function holdsTime(event: CalendarEvent, owner: string | null): boolean {
  const { component } = event
  return (
    component.getFirstPropertyValue('status') !== 'CANCELLED' &&
    component.getFirstPropertyValue('transp') !== 'TRANSPARENT' &&
    !declinedBy(event, owner)
  )
}

export function meetingsFromIcs(ics: string, now: Date): Meeting[] {
  const owner = ownerOf(ics)
  const expander = new IcalExpander({ ics, maxIterations: 0, skipInvalidDates: true })
  const { events, occurrences } = expander.between(
    new Date(now.getTime() - LOOK_BACK_MS),
    new Date(now.getTime() + LOOK_AHEAD_MS),
  )
  return [
    ...events.map(event => ({ event, start: event.startDate, end: event.endDate })),
    ...occurrences.map(entry => ({ event: entry.item, start: entry.startDate, end: entry.endDate })),
  ]
    .filter(({ event, start }) => !start.isDate && holdsTime(event, owner))
    .map(({ event, start, end }) => ({
      title: event.summary || 'Réunion',
      start: start.toJSDate().toISOString(),
      end: end.toJSDate().toISOString(),
    }))
    .filter(meeting => meeting.end > now.toISOString())
    .sort((a, b) => a.start.localeCompare(b.start))
}

// iCloud and Outlook hand out webcal:// links: the same feed over https
export function calendarUrl(url: string): string {
  return url.trim().replace(/^webcals?:\/\//i, 'https://')
}

export async function fetchCalendar(link: string): Promise<Meeting[]> {
  const url = calendarUrl(link)
  if (!url.startsWith('https://')) throw new Error('Adresse iCal invalide')
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Agenda ${response.status}`)
  // Outlook may start its feed with a byte-order mark
  const ics = (await response.text()).replace(/^\uFEFF/, '').trimStart()
  if (!ics.startsWith('BEGIN:VCALENDAR')) throw new Error('Adresse iCal invalide')
  return meetingsFromIcs(ics, new Date())
}
