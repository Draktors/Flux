import {
  AtSign,
  BellRing,
  CalendarDays,
  Check,
  CircleAlert,
  Globe,
  Keyboard,
  KeyRound,
  Layers,
  ListChecks,
  Mic,
  Plus,
  Settings2,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { AccountPicker } from './AccountPicker'
import { WorkspacesView } from './WorkspacesView'
import { TimePicker } from './TimePicker'
import { AddCalendarMenu, AddTrackerMenu, TrackerBadge, TRACKER_HINT, trackerInfo } from './Trackers'
import { calendarInfo } from '../../shared/calendars'
import type { GranolaStatus } from '../../shared/calls'
import type { TrackerName } from '../../shared/trackers'
import { useEffect, useState, type FormEvent } from 'react'
import type { GithubAccounts, NotificationAccess, Settings, SettingsPatch } from '../../shared/types'

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

const ACCESS_LABEL: Record<NotificationAccess, string> = {
  authorized: 'Autorisées par macOS',
  provisional: 'Autorisées par macOS, en mode discret',
  denied: 'Bloquées par macOS : active Flux dans les réglages',
  'not-determined': 'Pas encore autorisées',
  unsupported: 'Autorisation illisible, envoie un essai pour vérifier',
}

// A new reminder lands an hour after the last one
function nextTime(times: string[]): string {
  const last = [...times].sort().at(-1)
  if (!last) return '11:00'
  const hours = Math.min(Number(last.slice(0, 2)) + 1, 23)
  return `${String(hours).padStart(2, '0')}${last.slice(2)}`
}

type TextKey = Exclude<
  keyof SettingsPatch,
  'onboarded' | 'githubAccount' | 'workspace' | 'trackers' | 'calendar' | 'projects' | 'wrapupTimes'
>

export function SettingsPanel({
  onClose,
  onReplay,
  onSaved,
  onError,
  initialView = 'main',
}: {
  onClose(): void
  onReplay(): void
  onSaved(): void
  onError(message: string): void
  // The selector's button opens the window straight on its Espaces page
  initialView?: 'main' | 'workspaces'
}) {
  const [view, setView] = useState(initialView)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [patch, setPatch] = useState<SettingsPatch>({})
  const [saving, setSaving] = useState(false)
  const [accounts, setAccounts] = useState<GithubAccounts | null>(lastAccounts)
  const [granola, setGranola] = useState<GranolaStatus | null>(null)
  const [access, setAccess] = useState<NotificationAccess | null>(null)

  useEffect(() => {
    // Back from System Settings, the window regains focus: read the permission again
    const refresh = () => void window.flux.notificationAccess().then(setAccess)
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  useEffect(() => {
    void window.flux.getCalls().then(state => setGranola(state.granola))
    return window.flux.onCalls(state => setGranola(state.granola))
  }, [])

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

  const times = patch.wrapupTimes ?? settings.wrapupTimes
  const setTimes = (next: string[]) => setPatch(current => ({ ...current, wrapupTimes: next }))

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
      {view === 'workspaces' ? (
        <WorkspacesView
          onBack={
            initialView === 'main'
              ? () => {
                  setView('main')
                  // The summary line shows what the page just saved
                  void window.flux.getSettings().then(setSettings)
                }
              : undefined
          }
          onClose={onClose}
          onError={onError}
        />
      ) : (
      <>
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

      <div className="field">
        <span>Espaces</span>
        <div className="workspaces-summary">
          <Layers size={15} aria-hidden="true" />
          <span>
            {(settings.projects ?? []).length > 0
              ? (settings.projects ?? []).map(project => project.key).join(', ')
              : trackers.length > 0
                ? 'Aucun projet suivi'
                : 'Connecte Jira ou Linear pour suivre des projets'}
          </span>
          <button
            type="button"
            className="pill glass small"
            disabled={trackers.length === 0}
            onClick={() => setView('workspaces')}
          >
            Gérer
          </button>
        </div>
        <small>Chaque projet suivi devient un espace, avec sa file, ses PR et son daily.</small>
      </div>

      <section className="field trackers">
        <span>Transcriptions</span>
        <div className="tracker-card">
          <header>
            <span className="tracker-badge granola-badge" aria-hidden="true">
              <Mic size={15} />
            </span>
            <span className="tracker-name">
              <strong>Granola</strong>
              <small>
                {granola?.connected
                  ? `Connecté${granola.email ? ` en tant que ${granola.email}` : ''}`
                  : 'Résumés de tes calls, rangés par type et par produit'}
              </small>
            </span>
            {granola?.connected ? (
              <button
                type="button"
                className="pill glass small"
                onClick={() => void window.flux.disconnectGranola()}
              >
                Déconnecter
              </button>
            ) : (
              <button
                type="button"
                className="pill solid small"
                disabled={granola?.connecting}
                onClick={() => void window.flux.connectGranola().catch(() => undefined)}
              >
                {granola?.connecting ? 'Dans ton navigateur…' : 'Connecter'}
              </button>
            )}
          </header>
          {granola?.error && !granola.connecting && <small className="settings-error">{granola.error}</small>}
        </div>
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

      <section className="settings-wrapup">
        <span className="label-title">
          <ListChecks size={13} aria-hidden="true" />
          Relances wrap-up
        </span>
        <div className="settings-times">
          {times.map((time, index) => (
            <span className="time-slot" key={index}>
              <TimePicker
                value={time}
                onChange={value =>
                  setTimes(times.map((entry, position) => (position === index ? value : entry)))
                }
              />
              <button
                type="button"
                className="round glass small"
                aria-label={`Retirer la relance de ${time}`}
                onClick={() => setTimes(times.filter((_, position) => position !== index))}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
          {times.length < 6 && (
            <button
              type="button"
              className="pill glass small"
              onClick={() => setTimes([...times, nextTime(times)])}
            >
              <Plus size={14} aria-hidden="true" />
              Ajouter
            </button>
          )}
        </div>
        <small>
          Les jours ouvrés, une notification t’invite à cocher ce qui est fait et à choisir la suite.
          Pendant une réunion, elle attend la fin.
        </small>
      </section>

      <section className="settings-notifications">
        <span className="label-title">
          <BellRing size={13} aria-hidden="true" />
          Notifications
        </span>
        <p className={`access ${access === 'authorized' || access === 'provisional' ? 'ok' : 'warn'}`}>
          {access === 'authorized' || access === 'provisional' ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <CircleAlert size={14} aria-hidden="true" />
          )}
          {ACCESS_LABEL[access ?? 'unsupported']}
        </p>
        <div className="settings-row">
          {access === 'not-determined' && (
            <button
              type="button"
              className="pill glass small"
              onClick={() => void window.flux.requestNotificationAccess().then(setAccess)}
            >
              Autoriser
            </button>
          )}
          <button
            type="button"
            className="pill glass small"
            onClick={() => void window.flux.testNotification()}
          >
            Envoyer un essai
          </button>
          <button
            type="button"
            className="pill glass small"
            onClick={() => void window.flux.openNotificationSettings()}
          >
            <Settings2 size={14} aria-hidden="true" />
            Réglages macOS
          </button>
        </div>
      </section>

      <footer>
        <button type="button" className="pill glass small notify-test" onClick={onReplay}>
          Revoir l’accueil
        </button>
        <button type="submit" className="pill solid small" disabled={saving}>
          Enregistrer
        </button>
      </footer>
      </>
      )}
    </form>
    </div>
  )
}
