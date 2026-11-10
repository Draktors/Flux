import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { meetingsBetween, meetingsFromIcs } from '../src/main/sources/calendar'

const ICS = readFileSync(join(__dirname, 'fixtures/calendar.ics'), 'utf8')
const NOW = new Date('2026-11-06T08:00:00Z')

describe('agenda', () => {
  const meetings = meetingsFromIcs(ICS, NOW)
  const titles = meetings.map(meeting => meeting.title)

  it('garde une réunion en cours pour faire taire les notifications', () => {
    expect(meetings[0]).toMatchObject({ title: 'En cours', start: '2026-11-06T07:30:00.000Z' })
  })

  it('déroule une récurrence ancienne, à l’heure locale de Paris', () => {
    expect(meetings.find(meeting => meeting.title === 'Daily équipe')?.start).toBe(
      '2026-11-06T08:30:00.000Z',
    )
  })

  it('suit une occurrence déplacée', () => {
    expect(meetings.find(meeting => meeting.title === 'Point produit déplacé')?.start).toBe(
      '2026-11-06T14:30:00.000Z',
    )
    expect(titles).not.toContain('Point produit')
  })

  it('écarte ce qui ne prend pas mon temps', () => {
    for (const title of ['Atelier décliné', 'Télétravail', 'Créneau disponible', 'Annulé']) {
      expect(titles).not.toContain(title)
    }
    expect(titles).toContain('Atelier accepté')
  })

  it('se limite aux prochaines 24 heures, dans l’ordre', () => {
    expect(titles).not.toContain('Lundi prochain')
    expect(meetings.map(meeting => meeting.start)).toEqual(
      [...meetings.map(meeting => meeting.start)].sort(),
    )
  })

  it('respecte une exclusion de récurrence', () => {
    const tuesday = meetingsFromIcs(ICS, new Date('2026-11-10T07:00:00Z'))
    expect(tuesday.map(meeting => meeting.title)).not.toContain('Daily équipe')
  })

  it('oublie une réunion terminée', () => {
    const later = meetingsFromIcs(ICS, new Date('2026-11-06T09:00:00Z'))
    expect(later.map(meeting => meeting.title)).not.toContain('En cours')
  })
})

describe('agenda Outlook / Teams', () => {
  const outlook = readFileSync(join(__dirname, 'fixtures/outlook.ics'), 'utf8')
  const meetings = meetingsFromIcs(outlook, NOW)

  it('lit les fuseaux Windows publiés par Outlook', () => {
    expect(meetings.find(meeting => meeting.title === 'Daily Communicity')?.start).toBe(
      '2026-11-06T08:30:00.000Z',
    )
  })

  it('ignore les créneaux marqués disponibles', () => {
    expect(meetings.map(meeting => meeting.title)).not.toContain('Bloc libre')
  })
})

describe('agenda sur une période', () => {
  it('garde une réunion déjà terminée, pour le daily', () => {
    const later = new Date('2026-11-06T09:00:00Z')
    const day = meetingsBetween(ICS, new Date('2026-11-06T00:00:00Z'), later)
    expect(day.map(meeting => meeting.title)).toContain('En cours')
  })
})
