import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Check,
  CircleAlert,
  LoaderCircle,
  Settings2,
  SquareKanban,
  UserRound,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { CALENDARS, calendarInfo, type CalendarName } from '../../shared/calendars'
import { PROFILE_LABEL, type ProfileId, type Profiles } from '../../shared/profiles'
import { TRACKERS, type TrackerName } from '../../shared/trackers'
import type { CheckResult, NotificationAccess, Rank, Settings, TrackedProject } from '../../shared/types'

import { BrandIcon, type Brand } from './Brand'
import { PROFILE_ICON } from './Profiles'
import { ProjectsPicker } from './Projects'
import { rankStyle, tint, type RankStyle } from './rankStyle'
import { TrackerBadge, TRACKER_HINT, trackerInfo } from './Trackers'

type SecretKey = 'linearKey' | 'calendarUrl'
type StepKey =
  | 'welcome'
  | 'profiles'
  | 'github'
  | 'tools'
  | 'jira'
  | 'linear'
  | 'projects'
  | 'calendar'
  | 'notifications'
  | 'done'

interface Step {
  key: StepKey
  rank: Rank
  // A brand logo for the services Flux connects to, a lucide glyph otherwise
  icon: LucideIcon | Brand
  eyebrow: string
  title: string
  text: string
  help?: string
  secret?: { name: SecretKey; placeholder: string; saved: (settings: Settings) => boolean }
}

// Steps that connect a source, numbered in the eyebrow
const CONNECTIONS: StepKey[] = ['github', 'jira', 'linear', 'calendar']

const ALL_STEPS: Record<StepKey, Omit<Step, 'eyebrow'> & { eyebrow?: string }> = {
  welcome: {
    key: 'welcome',
    rank: 6,
    icon: Waves,
    eyebrow: 'Bienvenue',
    title: 'Flux tire ton travail vers toi.',
    text: 'Quelques connexions et ta file se remplit seule : les PR depuis GitHub, les tickets depuis ton outil de gestion de projet, les réunions depuis ton agenda. Tout reste sur ce Mac.',
  },
  profiles: {
    key: 'profiles',
    rank: 6,
    icon: UserRound,
    eyebrow: 'Profils',
    title: 'Un Flux ou deux ?',
    text: 'Pro et Perso vivent à part : chacun ses comptes, ses clefs, ses espaces et sa file. Un bouton à côté du logo passe de l’un à l’autre.',
  },
  github: {
    key: 'github',
    rank: 2,
    icon: 'github',
    title: 'GitHub',
    text: 'Flux lit tes PR avec la CLI gh déjà connectée sur ce Mac : aucune clef à saisir ici.',
  },
  tools: {
    key: 'tools',
    rank: 5,
    icon: SquareKanban,
    eyebrow: 'Gestion de projet',
    title: 'Où vivent tes tickets ?',
    text: 'Choisis les outils que ton équipe utilise. Flux ne demandera que leurs clefs, et tu pourras en ajouter plus tard dans les réglages.',
  },
  jira: {
    key: 'jira',
    rank: 5,
    icon: SquareKanban,
    title: 'Jira',
    text: 'Ton site Atlassian, ton e-mail et un jeton API pour suivre les tickets qui te sont assignés.',
    help: 'Jeton : id.atlassian.com → Sécurité → Jetons d’API.',
  },
  linear: {
    key: 'linear',
    rank: 5,
    icon: SquareKanban,
    title: 'Linear',
    text: 'Une clef personnelle pour suivre les tickets cités par tes sujets et tes mentions.',
    help: 'Linear → Settings → Security & access → Personal API keys.',
    secret: {
      name: 'linearKey',
      placeholder: 'lin_api_…',
      saved: settings => settings.hasLinearKey,
    },
  },
  projects: {
    key: 'projects',
    rank: 6,
    icon: SquareKanban,
    eyebrow: 'Tes projets',
    title: 'Sur quoi travailles-tu ?',
    text: 'Coche tes projets : chacun devient un espace, avec sa file, ses PR et son daily. Ajoute à chacun ses dépôts GitHub.',
  },
  calendar: {
    key: 'calendar',
    rank: 3,
    icon: CalendarDays,
    title: 'Agenda',
    text: 'Flux se tait pendant tes réunions et te montre la suivante. Choisis ton agenda, puis colle son lien iCal secret.',
    secret: {
      name: 'calendarUrl',
      placeholder: '',
      saved: settings => settings.hasCalendarUrl,
    },
  },
  notifications: {
    key: 'notifications',
    rank: 1,
    icon: BellRing,
    eyebrow: 'Dernier réglage',
    title: 'Notifications',
    text: 'Flux te prévient quand un sujet passe devant ou que ton daily est prêt. macOS te demande ton accord une seule fois.',
  },
  done: {
    key: 'done',
    rank: 4,
    icon: Check,
    eyebrow: 'C’est prêt',
    title: 'Ta file t’attend.',
    text: 'Tu pourras changer ces clefs et tes outils plus tard dans les réglages.',
  },
}

// Perso starts from its own welcome, without the choice of profiles Pro already made
const PERSO_WELCOME = {
  title: 'Ton Flux perso.',
  text: 'Ce profil a ses propres comptes, clefs et espaces : rien de ton Flux pro n’y apparaît. Quelques connexions et sa file se remplit seule.',
}

const PROFILE_CHOICES: { perso: boolean; label: string; hint: string; icons: ProfileId[] }[] = [
  { perso: false, label: 'Pro seulement', hint: 'Un seul Flux, pour le travail', icons: ['pro'] },
  { perso: true, label: 'Pro et Perso', hint: 'Perso se règle juste après', icons: ['pro', 'perso'] },
]

function buildSteps(trackers: TrackerName[], profile: ProfileId, twoProfiles: boolean): Step[] {
  const keys: StepKey[] = [
    'welcome',
    ...(profile === 'pro' ? (['profiles'] as const) : []),
    'github',
    'tools',
    ...(['jira', 'linear'] as const).filter(name => trackers.includes(name)),
    ...(trackers.length > 0 ? (['projects'] as const) : []),
    'calendar',
    'notifications',
    'done',
  ]
  const connections = keys.filter(key => CONNECTIONS.includes(key))
  // With two profiles, every eyebrow says which one you are setting up
  const prefix = twoProfiles ? `${PROFILE_LABEL[profile]} · ` : ''
  return keys.map(key => {
    const step = { ...ALL_STEPS[key], ...(key === 'welcome' && profile === 'perso' ? PERSO_WELCOME : {}) }
    const position = connections.indexOf(key)
    const eyebrow =
      step.eyebrow ?? `Connexion ${position + 1} sur ${connections.length}`
    return { ...step, eyebrow: key === 'profiles' ? eyebrow : `${prefix}${eyebrow}` }
  })
}

type Status = { state: 'idle' } | { state: 'checking' } | ({ state: 'done' } & CheckResult)

const allowed = (access: NotificationAccess | null) =>
  access === 'authorized' || access === 'provisional'

function accessStatus(access: NotificationAccess | null, asking: boolean): Status {
  if (asking)
    return { state: 'done', ok: true, detail: 'Réponds à la demande de macOS en haut à droite.' }
  if (access === null) return { state: 'checking' }
  if (allowed(access)) return { state: 'done', ok: true, detail: 'Notifications autorisées' }
  if (access === 'denied') {
    return {
      state: 'done',
      ok: false,
      detail:
        'macOS bloque les notifications de Flux. Active-les dans les réglages, Flux revérifie à ton retour.',
    }
  }
  if (access === 'unsupported') {
    return {
      state: 'done',
      ok: false,
      detail: 'Flux ne peut pas lire l’autorisation : envoie un essai.',
    }
  }
  return { state: 'idle' }
}

const CHECKS: Record<SecretKey, (value: string) => Promise<CheckResult>> = {
  linearKey: value => window.flux.checkLinearKey(value),
  calendarUrl: value => window.flux.checkCalendarUrl(value),
}

function StatusLine({ status }: { status: Status }) {
  if (status.state === 'idle') return null
  if (status.state === 'checking') {
    return (
      <p className="onboarding-status" role="status">
        <LoaderCircle size={15} className="spin" aria-hidden="true" />
        Vérification…
      </p>
    )
  }
  return (
    <p className={`onboarding-status ${status.ok ? 'ok' : 'error'}`} role="status">
      {status.ok ? (
        <Check size={15} aria-hidden="true" />
      ) : (
        <CircleAlert size={15} aria-hidden="true" />
      )}
      {status.detail}
    </p>
  )
}

interface JiraDraft {
  site: string
  email: string
  token: string
}

export function Onboarding({ onTint, onDone }: { onTint(style: RankStyle): void; onDone(): void }) {
  const [index, setIndex] = useState(0)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [trackers, setTrackers] = useState<TrackerName[]>([])
  const [calendar, setCalendar] = useState<CalendarName | null>(null)
  const [value, setValue] = useState('')
  const [jira, setJira] = useState<JiraDraft>({ site: '', email: '', token: '' })
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [github, setGithub] = useState<Status>({ state: 'idle' })
  const [access, setAccess] = useState<NotificationAccess | null>(null)
  // null until you touch the picker, so an untouched step keeps config.json
  const [projects, setProjects] = useState<TrackedProject[] | null>(null)
  const [asking, setAsking] = useState(false)
  const [profiles, setProfiles] = useState<Profiles | null>(null)
  const [perso, setPerso] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const profile = profiles?.active ?? 'pro'
  const steps = useMemo(() => buildSteps(trackers, profile, perso), [trackers, profile, perso])
  const step = steps[Math.min(index, steps.length - 1)]
  const style = rankStyle(step.rank)

  useEffect(() => {
    void window.flux.getSettings().then(loaded => {
      setSettings(loaded)
      setTrackers(loaded.trackers)
      setCalendar(loaded.calendar)
      setJira({ site: loaded.jiraSite, email: loaded.jiraEmail, token: '' })
    })
    void window.flux.profiles().then(loaded => {
      setProfiles(loaded)
      setPerso(loaded.perso)
    })
  }, [])

  useEffect(() => {
    onTint(style)
    setValue('')
    setStatus({ state: 'idle' })
    if (step.key === 'github' && github.state === 'idle') void verifyGithub()
    input.current?.focus()
  }, [index])

  // Back from System Settings, the window regains focus: read the permission again
  useEffect(() => {
    if (step.key !== 'notifications') return
    const refresh = () => void window.flux.notificationAccess().then(setAccess)
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [step.key])

  const askNotifications = async () => {
    setAsking(true)
    const answer = await window.flux.requestNotificationAccess()
    setAsking(false)
    setAccess(answer)
    if (allowed(answer)) void window.flux.testNotification()
  }

  const verifyGithub = async () => {
    setGithub({ state: 'checking' })
    setGithub({ state: 'done', ...(await window.flux.checkGithub()) })
  }

  const next = () => setIndex(current => Math.min(current + 1, steps.length - 1))
  const back = () => setIndex(current => Math.max(current - 1, 0))

  const finish = async () => {
    await window.flux.saveSettings({ onboarded: true })
    onDone()
  }

  // Pro is ready: Flux relaunches on Perso, whose own welcome starts since it has never run
  const setUpPerso = async () => {
    await window.flux.saveSettings({ onboarded: true })
    await window.flux.setProfiles({ active: 'perso' })
  }
  const persoToSetUp =
    profile === 'pro' && perso && !profiles?.list.find(entry => entry.id === 'perso')?.onboarded

  const reload = async () => setSettings(await window.flux.getSettings())

  const saveSecret = async (name: SecretKey) => {
    setStatus({ state: 'checking' })
    const result = await CHECKS[name](value)
    setStatus({ state: 'done', ...result })
    if (!result.ok) return
    await window.flux.saveSettings(
      name === 'calendarUrl' && calendar
        ? { calendarUrl: value.trim(), calendar }
        : { [name]: value.trim() },
    )
    await reload()
    setValue('')
  }

  const jiraSaved = Boolean(settings?.hasJiraToken && settings.jiraSite && settings.jiraEmail)
  const jiraTyped = Boolean(jira.token.trim())

  const saveJira = async () => {
    setStatus({ state: 'checking' })
    const result = await window.flux.checkJira(jira.site, jira.email, jira.token)
    setStatus({ state: 'done', ...result })
    if (!result.ok) return
    await window.flux.saveSettings({
      jiraSite: jira.site.trim(),
      jiraEmail: jira.email.trim(),
      jiraToken: jira.token.trim(),
    })
    await reload()
    setJira(current => ({ ...current, token: '' }))
  }

  const verified = status.state === 'done' && status.ok

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (step.key === 'done') return void finish()
    if (step.key === 'profiles') {
      void window.flux.setProfiles({ perso }).then(() => window.flux.profiles().then(setProfiles))
      return next()
    }
    if (step.key === 'notifications' && access === 'not-determined') return void askNotifications()
    if (step.key === 'projects') {
      if (projects !== null) void window.flux.saveSettings({ projects }).then(reload)
      return next()
    }
    if (step.key === 'tools') {
      void window.flux.saveSettings({ trackers }).then(reload)
      return next()
    }
    if (step.key === 'calendar' && !calendar) {
      void window.flux.saveSettings({ calendar: 'none' }).then(reload)
      return next()
    }
    if (step.key === 'jira' && jiraTyped && !verified) return void saveJira()
    if (secret && value.trim() && !verified) return void saveSecret(secret.name)
    next()
  }

  const toggle = (name: TrackerName) =>
    setTrackers(current =>
      current.includes(name) ? current.filter(entry => entry !== name) : [...current, name],
    )

  const Icon = step.icon
  const PersoIcon = PROFILE_ICON.perso
  // The calendar step asks for its link only once a calendar is chosen, with that calendar's help
  const secret =
    step.key === 'calendar'
      ? calendar
        ? { ...step.secret!, placeholder: calendarInfo(calendar).placeholder }
        : undefined
      : step.secret
  const help = step.key === 'calendar' && calendar ? calendarInfo(calendar).help : step.help
  const saved = secret && settings ? secret.saved(settings) : false
  const pending = (secret && value.trim()) || (step.key === 'jira' && jiraTyped)
  const primary = (() => {
    if (step.key === 'welcome') return 'Commencer'
    if (step.key === 'done') return 'Ouvrir Flux'
    if (step.key === 'tools' && trackers.length === 0) return 'Aucun pour l’instant'
    if (step.key === 'calendar' && !calendar) return 'Pas d’agenda'
    if (step.key === 'notifications' && access === 'not-determined')
      return 'Autoriser les notifications'
    if (pending && !verified) return 'Vérifier et enregistrer'
    return 'Continuer'
  })()
  const canLater =
    (secret && !saved && !verified) ||
    (step.key === 'jira' && !jiraSaved && !verified) ||
    (step.key === 'notifications' && access === 'not-determined')
  const summary = settings
    ? [
        { label: 'GitHub', ok: github.state === 'done' && github.ok },
        ...trackers.map(name => ({
          label: trackerInfo(name).label,
          ok: name === 'jira' ? jiraSaved : settings.hasLinearKey,
        })),
        ...(calendar ? [{ label: calendarInfo(calendar).label, ok: settings.hasCalendarUrl }] : []),
        { label: 'Notifications', ok: allowed(access) },
      ]
    : []

  return (
    <div className="onboarding" style={tint(style)}>
      <button
        type="button"
        className="onboarding-skip pill glass small"
        onClick={() => void finish()}
      >
        Passer l’accueil
      </button>

      <form className="onboarding-card glass-dark" onSubmit={submit}>
        <ol className="onboarding-dots" aria-label={`Étape ${index + 1} sur ${steps.length}`}>
          {steps.map((entry, position) => (
            <li
              key={entry.key}
              aria-current={position === index ? 'step' : undefined}
              className={position < index ? 'past' : undefined}
            />
          ))}
        </ol>

        <div className="onboarding-step" key={step.key}>
          <span className="onboarding-icon">
            {step.key === 'jira' || step.key === 'linear' ? (
              <TrackerBadge name={step.key} size={30} />
            ) : typeof Icon === 'string' ? (
              <BrandIcon brand={Icon} size={26} />
            ) : (
              <Icon size={26} strokeWidth={2.2} aria-hidden="true" />
            )}
          </span>
          <p className="onboarding-eyebrow">{step.eyebrow}</p>
          <h1>{step.title}</h1>
          <p className="onboarding-text">{step.text}</p>

          {step.key === 'github' && (
            <>
              <StatusLine status={github} />
              {github.state === 'done' && !github.ok && (
                <button
                  type="button"
                  className="pill glass small"
                  onClick={() => void verifyGithub()}
                >
                  Revérifier
                </button>
              )}
            </>
          )}

          {step.key === 'profiles' && (
            <div className="onboarding-tools" role="group" aria-label="Profils">
              {PROFILE_CHOICES.map(choice => (
                <button
                  type="button"
                  key={choice.label}
                  className="onboarding-tool"
                  aria-pressed={perso === choice.perso}
                  onClick={() => setPerso(choice.perso)}
                >
                  <span className="onboarding-profile-icons" aria-hidden="true">
                    {choice.icons.map(id => {
                      const ProfileIcon = PROFILE_ICON[id]
                      return <ProfileIcon key={id} size={22} />
                    })}
                  </span>
                  <strong>{choice.label}</strong>
                  <small>{choice.hint}</small>
                  {perso === choice.perso && (
                    <Check size={15} aria-hidden="true" className="onboarding-tool-check" />
                  )}
                </button>
              ))}
            </div>
          )}

          {step.key === 'tools' && (
            <div className="onboarding-tools" role="group" aria-label="Outils de gestion de projet">
              {TRACKERS.map(tracker => {
                const on = trackers.includes(tracker.id)
                return (
                  <button
                    type="button"
                    key={tracker.id}
                    className="onboarding-tool"
                    aria-pressed={on}
                    disabled={tracker.soon}
                    onClick={() => toggle(tracker.id)}
                  >
                    <TrackerBadge name={tracker.id} size={32} />
                    <strong>{tracker.label}</strong>
                    <small>{tracker.soon ? 'Bientôt' : TRACKER_HINT[tracker.id]}</small>
                    {on && <Check size={15} aria-hidden="true" className="onboarding-tool-check" />}
                  </button>
                )
              })}
            </div>
          )}

          {step.key === 'jira' && (
            <div className="onboarding-field">
              <input
                ref={input}
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://entreprise.atlassian.net"
                value={jira.site}
                onChange={event => {
                  setJira(current => ({ ...current, site: event.target.value }))
                  setStatus({ state: 'idle' })
                }}
              />
              <input
                type="email"
                autoComplete="off"
                spellCheck={false}
                placeholder="prenom.nom@entreprise.fr"
                value={jira.email}
                onChange={event => {
                  setJira(current => ({ ...current, email: event.target.value }))
                  setStatus({ state: 'idle' })
                }}
              />
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  settings?.hasJiraToken
                    ? 'Jeton déjà enregistré, colle-en un nouveau pour le remplacer'
                    : 'Jeton API'
                }
                value={jira.token}
                onChange={event => {
                  setJira(current => ({ ...current, token: event.target.value }))
                  setStatus({ state: 'idle' })
                }}
              />
              <small>{step.help}</small>
            </div>
          )}

          {step.key === 'calendar' && (
            <div className="onboarding-tools compact" role="group" aria-label="Agenda">
              {CALENDARS.map(entry => {
                const on = calendar === entry.id
                return (
                  <button
                    type="button"
                    key={entry.id}
                    className="onboarding-tool"
                    aria-pressed={on}
                    onClick={() => {
                      setCalendar(on ? null : entry.id)
                      setStatus({ state: 'idle' })
                    }}
                  >
                    <TrackerBadge name={entry.id} size={28} />
                    <strong>{entry.label}</strong>
                    {on && <Check size={15} aria-hidden="true" className="onboarding-tool-check" />}
                  </button>
                )
              })}
            </div>
          )}

          {secret && (
            <label className="onboarding-field">
              <input
                ref={input}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={value}
                placeholder={
                  saved
                    ? 'Déjà enregistrée, colle une nouvelle valeur pour la remplacer'
                    : secret.placeholder
                }
                onChange={event => {
                  setValue(event.target.value)
                  setStatus({ state: 'idle' })
                }}
              />
              {help && <small>{help}</small>}
            </label>
          )}
          {(secret || step.key === 'jira') && <StatusLine status={status} />}

          {step.key === 'projects' && (
            <ProjectsPicker
              trackers={trackers}
              value={projects ?? settings?.projects ?? []}
              onChange={setProjects}
            />
          )}

          {step.key === 'notifications' && (
            <>
              <StatusLine status={accessStatus(access, asking)} />
              <div className="onboarding-buttons">
                {(allowed(access) || access === 'unsupported') && (
                  <button
                    type="button"
                    className="pill glass small"
                    onClick={() => void window.flux.testNotification()}
                  >
                    <BellRing size={15} aria-hidden="true" />
                    Envoyer un essai
                  </button>
                )}
                {(access === 'denied' || access === 'unsupported') && (
                  <button
                    type="button"
                    className="pill glass small"
                    onClick={() => void window.flux.openNotificationSettings()}
                  >
                    <Settings2 size={15} aria-hidden="true" />
                    Ouvrir les réglages
                  </button>
                )}
              </div>
            </>
          )}

          {step.key === 'done' && (
            <ul className="onboarding-summary">
              {summary.map(entry => (
                <li key={entry.label} className={entry.ok ? 'ok' : undefined}>
                  {entry.ok ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <CircleAlert size={15} aria-hidden="true" />
                  )}
                  {entry.label}
                  <small>{entry.ok ? 'Connecté' : 'À connecter plus tard'}</small>
                </li>
              ))}
            </ul>
          )}

          {step.key === 'done' && persoToSetUp && (
            <button
              type="button"
              className="pill glass small onboarding-next-profile"
              onClick={() => void setUpPerso()}
            >
              <PersoIcon size={15} aria-hidden="true" />
              Régler Perso maintenant
            </button>
          )}
        </div>

        <footer className="onboarding-actions">
          {index > 0 && (
            <button type="button" className="pill glass small" onClick={back}>
              Retour
            </button>
          )}
          {canLater && (
            <button type="button" className="onboarding-later" onClick={next}>
              Plus tard
            </button>
          )}
          <button
            type="submit"
            className="pill solid"
            disabled={status.state === 'checking' || asking}
          >
            {primary}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </footer>
      </form>
    </div>
  )
}
