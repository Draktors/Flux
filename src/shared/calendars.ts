// Calendars Flux reads through their secret iCal link
export type CalendarName = 'outlook' | 'google' | 'apple'

export interface CalendarInfo {
  id: CalendarName
  label: string
  hint: string
  // Where to find the iCal link in that calendar
  help: string
  placeholder: string
}

export const CALENDARS: CalendarInfo[] = [
  {
    id: 'outlook',
    label: 'Outlook / Teams',
    hint: 'Réunions Teams et Outlook',
    help: 'Outlook sur le web → Paramètres → Calendrier → Calendriers partagés → Publier un calendrier (« Peut afficher tous les détails ») → copie le lien ICS.',
    placeholder: 'https://outlook.office365.com/owa/calendar/…/calendar.ics',
  },
  {
    id: 'google',
    label: 'Google Agenda',
    hint: 'Réunions Google Meet et autres',
    help: 'Google Agenda → Paramètres de ton agenda → Adresse secrète au format iCal.',
    placeholder: 'https://calendar.google.com/…/basic.ics',
  },
  {
    id: 'apple',
    label: 'iCloud',
    hint: 'Calendrier Apple partagé',
    help: 'iCloud.com → Calendrier → partage du calendrier → Calendrier public → copie le lien.',
    placeholder: 'webcal://p…-caldav.icloud.com/published/…',
  },
]

export function calendarInfo(name: CalendarName): CalendarInfo {
  return CALENDARS.find(calendar => calendar.id === name)!
}
