import { AtSign, CalendarDays, Check, Globe, Keyboard, KeyRound, X, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AccountPicker } from './AccountPicker'
import { TimePicker } from './TimePicker'
import { AddCalendarMenu, AddTrackerMenu, TrackerBadge, TRACKER_HINT, trackerInfo } from './Trackers'
import { calendarInfo } from '../../shared/calendars'
import type { TrackerName } from '../../shared/trackers'
import { useEffect, useState, type FormEvent } from 'react'
import type { GithubAccounts, Settings, SettingsPatch } from '../../shared/types'

function InputShell({ icon: Icon, stored, children }: { icon: LucideIcon; stored?: boolean; children: ReactNode }) {
  return (
    <span className="input-shell">
      <Icon size={16} aria-hidden="true" className="input-icon" />
      {children}
      {stored && (
        <span className="input-stored">
          <Check size={12} aria-hidden="true" />
          Enregistrée
        </span>
      )}
    </span>
  )
}

// Kept across openings so profile pictures show at once when the panel comes back
let lastAccounts: GithubAccounts | null = null

type TextKey = Exclude<
  keyof SettingsPatch,
  'onboarded' | 'githubAccount' | 'workspace' | 'trackers' | 'calendar'
>

export function SettingsPanel({
  onClose,
  onReplay,
  onSaved,
  onError,
}: {
  onClose(): void
  onReplay(): void
  onSaved(): void
  onError(message: string): void
}) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [patch, setPatch] = useState<SettingsPatch>({})
  const [saving, setSaving] = useState(false)
  const [accounts, setAccounts] = useState<GithubAccounts | null>(lastAccounts)

  useEffect(() => {
    void window.flux.getSettings().then(setSettings)
    void window.flux
      .githubAccounts()
      .then(fresh => {
        lastAccounts = fresh
        setAccounts(fresh)
      })
      .catch(() => {
        if (!lastAccounts) setAccounts({ host: 'github.com', logins: [], active: null, profiles: {} })
      })
  }, [])

  if (!settings) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await window.flux.saveSettings(patch)
      onSaved()
    } catch (error) {
      setSaving(false)
      onError(`Réglages non enregistrés : ${(error as Error).message}`)
    }
  }

  const chosenAccount =
    patch.githubAccount !== undefined ? patch.githubAccount : settings.githubAccount

  const trackers = patch.trackers ?? settings.trackers
  const chosenCalendar = patch.calendar ?? settings.calendar
  const calendar = chosenCalendar === 'none' ? null : chosenCalendar
  const setTrackers = (next: TrackerName[]) => setPatch(current => ({ ...current, trackers: next }))

  const field = (key: TextKey) => ({
    value: patch[key] ?? '',
    onChange: (event: { target: { value: string } }) => {
      setPatch(current => ({ ...current, [key]: event.target.value }))
    },
  })

  return (
    <div className="scrim" onClick={onClose}>
    <form
      className="settings glass-dark"
      onSubmit={submit}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <header>
        <h1>Réglages</h1>
        <button type="button" className="round glass small" aria-label="Fermer" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="field">
        <span>Compte GitHub</span>
        <AccountPicker
          accounts={accounts}
          value={chosenAccount}
          onChange={githubAccount => {
            setPatch(current => ({ ...current, githubAccount }))
          }}
        />
        <small>Flux lit GitHub avec ce compte, sans changer celui de ton terminal.</small>
      </div>

      <section className="field trackers">
        <span>Gestion de projet</span>
        {trackers.length === 0 && (
          <small>Aucun outil : Flux ne suit que tes PR GitHub et tes notes.</small>
        )}
        {trackers.map(name => (
          <div className="tracker-card" key={name}>
            <header>
              <TrackerBadge name={name} />
              <span className="tracker-name">
                <strong>{trackerInfo(name).label}</strong>
                <small>{TRACKER_HINT[name]}</small>
              </span>
              <button
                type="button"
                className="round glass small"
                aria-label={`Retirer ${trackerInfo(name).label}`}
                title="Retirer"
                onClick={() => setTrackers(trackers.filter(entry => entry !== name))}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </header>

            {name === 'jira' && (
              <>
                <InputShell icon={Globe}>
                  <input
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://entreprise.atlassian.net"
                    value={patch.jiraSite ?? settings.jiraSite}
                    onChange={field('jiraSite').onChange}
                  />
                </InputShell>
                <InputShell icon={AtSign}>
                  <input
                    type="email"
                    autoComplete="off"
                    placeholder="prenom.nom@entreprise.fr"
                    value={patch.jiraEmail ?? settings.jiraEmail}
                    onChange={field('jiraEmail').onChange}
                  />
                </InputShell>
                <InputShell icon={KeyRound} stored={settings.hasJiraToken && !patch.jiraToken}>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={settings.hasJiraToken ? 'Remplacer le jeton' : 'Jeton API'}
                    {...field('jiraToken')}
                  />
                </InputShell>
                <small>Jeton : id.atlassian.com → Sécurité → Jetons d’API.</small>
              </>
            )}

            {name === 'linear' && (
              <>
                <InputShell icon={KeyRound} stored={settings.hasLinearKey && !patch.linearKey}>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={settings.hasLinearKey ? 'Remplacer la clef' : 'lin_api_…'}
                    {...field('linearKey')}
                  />
                </InputShell>
                <small>Linear → Settings → Security &amp; access → Personal API keys.</small>
              </>
            )}
          </div>
        ))}
        <AddTrackerMenu chosen={trackers} onAdd={name => setTrackers([...trackers, name])} />
      </section>

      <section className="field trackers">
        <span>Agenda</span>
        {calendar ? (
          <div className="tracker-card">
            <header>
              <TrackerBadge name={calendar} />
              <span className="tracker-name">
                <strong>{calendarInfo(calendar).label}</strong>
                <small>Flux se tait pendant tes réunions et affiche la suivante</small>
              </span>
              <button
                type="button"
                className="round glass small"
                aria-label={`Retirer ${calendarInfo(calendar).label}`}
                title="Retirer"
                onClick={() => setPatch(current => ({ ...current, calendar: 'none' }))}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </header>
            <InputShell icon={CalendarDays} stored={settings.hasCalendarUrl && !patch.calendarUrl}>
              <input
                type="password"
                autoComplete="off"
                placeholder={
                  settings.hasCalendarUrl ? 'Remplacer le lien iCal' : calendarInfo(calendar).placeholder
                }
                {...field('calendarUrl')}
              />
            </InputShell>
            <small>{calendarInfo(calendar).help}</small>
          </div>
        ) : (
          <>
            <small>Aucun agenda : Flux ne connaît pas tes réunions.</small>
            <AddCalendarMenu onAdd={name => setPatch(current => ({ ...current, calendar: name }))} />
          </>
        )}
      </section>

      <div className="settings-row">
        <div className="field">
          <span>Heure du daily</span>
          <TimePicker
            value={patch.dailyTime ?? settings.dailyTime}
            onChange={dailyTime => setPatch(current => ({ ...current, dailyTime }))}
          />
        </div>

        <label>
          Raccourci de capture
          <InputShell icon={Keyboard}>
            <input
              value={patch.captureShortcut ?? settings.captureShortcut}
              onChange={field('captureShortcut').onChange}
            />
          </InputShell>
        </label>
      </div>

      <footer>
        <button
          type="button"
          className="pill glass small notify-test"
          onClick={() => void window.flux.testNotification()}
        >
          Tester une notification
        </button>
        <button type="button" className="pill glass small" onClick={onReplay}>
          Revoir l’accueil
        </button>
        <button type="submit" className="pill solid small" disabled={saving}>
          Enregistrer
        </button>
      </footer>
    </form>
    </div>
  )
}
