import {
  ArrowRight,
  BellRing,
  Check,
  CircleAlert,
  LoaderCircle,
  Settings2,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import type { CheckResult, NotificationAccess, Rank, Settings } from '../../shared/types'

import { BrandIcon, type Brand } from './Brand'
import { rankStyle, tint, type RankStyle } from './rankStyle'

type SecretKey = 'linearKey' | 'calendarUrl'

interface Step {
  key: 'welcome' | 'github' | 'linear' | 'calendar' | 'notifications' | 'done'
  rank: Rank
  // A brand logo for the services Flux connects to, a lucide glyph otherwise
  icon: LucideIcon | Brand
  eyebrow: string
  title: string
  text: string
  help?: string
  secret?: { name: SecretKey; placeholder: string; saved: (settings: Settings) => boolean }
}

const STEPS: Step[] = [
  {
    key: 'welcome',
    rank: 6,
    icon: Waves,
    eyebrow: 'Bienvenue',
    title: 'Flux tire ton travail vers toi.',
    text: 'Trois connexions et ta file se remplit seule : les PR depuis GitHub, les tickets depuis Linear, les réunions depuis ton agenda. Tout reste sur ce Mac.',
  },
  {
    key: 'github',
    rank: 2,
    icon: 'github',
    eyebrow: 'Connexion 1 sur 3',
    title: 'GitHub',
    text: 'Flux lit tes PR avec la CLI gh déjà connectée sur ce Mac : aucune clef à saisir ici.',
  },
  {
    key: 'linear',
    rank: 5,
    icon: 'linear',
    eyebrow: 'Connexion 2 sur 3',
    title: 'Linear',
    text: 'Une clef personnelle pour suivre les tickets cités par tes sujets et tes mentions.',
    help: 'Linear → Settings → Security & access → Personal API keys.',
    secret: {
      name: 'linearKey',
      placeholder: 'lin_api_…',
      saved: settings => settings.hasLinearKey,
    },
  },
  {
    key: 'calendar',
    rank: 3,
    icon: 'calendar',
    eyebrow: 'Connexion 3 sur 3',
    title: 'Agenda',
    text: 'L’adresse iCal secrète de ton agenda : Flux se tait pendant tes réunions et te montre la suivante.',
    help: 'Google Agenda → Paramètres de ton agenda → Adresse secrète au format iCal.',
    secret: {
      name: 'calendarUrl',
      placeholder: 'https://calendar.google.com/…/basic.ics',
      saved: settings => settings.hasCalendarUrl,
    },
  },
  {
    key: 'notifications',
    rank: 1,
    icon: BellRing,
    eyebrow: 'Dernier réglage',
    title: 'Notifications',
    text: 'Flux te prévient quand un sujet passe devant ou que ton daily est prêt. macOS te demande ton accord une seule fois.',
  },
  {
    key: 'done',
    rank: 4,
    icon: Check,
    eyebrow: 'C’est prêt',
    title: 'Ta file t’attend.',
    text: 'Tu pourras changer ces clefs plus tard dans les réglages.',
  },
]

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

export function Onboarding({ onTint, onDone }: { onTint(style: RankStyle): void; onDone(): void }) {
  const [index, setIndex] = useState(0)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [github, setGithub] = useState<Status>({ state: 'idle' })
  const [access, setAccess] = useState<NotificationAccess | null>(null)
  const [asking, setAsking] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const step = STEPS[index]
  const style = rankStyle(step.rank)

  useEffect(() => {
    void window.flux.getSettings().then(setSettings)
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

  const next = () => setIndex(current => Math.min(current + 1, STEPS.length - 1))
  const back = () => setIndex(current => Math.max(current - 1, 0))

  const finish = async () => {
    await window.flux.saveSettings({ onboarded: true })
    onDone()
  }

  const saveSecret = async (name: SecretKey) => {
    setStatus({ state: 'checking' })
    const result = await CHECKS[name](value)
    setStatus({ state: 'done', ...result })
    if (!result.ok) return
    await window.flux.saveSettings({ [name]: value.trim() })
    setSettings(await window.flux.getSettings())
    setValue('')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (step.key === 'done') return void finish()
    if (step.key === 'notifications' && access === 'not-determined') return void askNotifications()
    if (step.secret && value.trim() && !(status.state === 'done' && status.ok)) {
      return void saveSecret(step.secret.name)
    }
    next()
  }

  const Icon = step.icon
  const saved = step.secret && settings ? step.secret.saved(settings) : false
  const verified = status.state === 'done' && status.ok
  const primary = (() => {
    if (step.key === 'welcome') return 'Commencer'
    if (step.key === 'done') return 'Ouvrir Flux'
    if (step.key === 'notifications' && access === 'not-determined')
      return 'Autoriser les notifications'
    if (step.secret && value.trim() && !verified) return 'Vérifier et enregistrer'
    return 'Continuer'
  })()
  const summary = settings
    ? [
        { label: 'GitHub', ok: github.state === 'done' && github.ok },
        { label: 'Linear', ok: settings.hasLinearKey },
        { label: 'Agenda', ok: settings.hasCalendarUrl },
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
        <ol className="onboarding-dots" aria-label={`Étape ${index + 1} sur ${STEPS.length}`}>
          {STEPS.map((entry, position) => (
            <li
              key={entry.key}
              aria-current={position === index ? 'step' : undefined}
              className={position < index ? 'past' : undefined}
            />
          ))}
        </ol>

        <div className="onboarding-step" key={step.key}>
          <span className="onboarding-icon">
            {typeof Icon === 'string' ? (
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

          {step.secret && (
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
                    : step.secret.placeholder
                }
                onChange={event => {
                  setValue(event.target.value)
                  setStatus({ state: 'idle' })
                }}
              />
              {step.help && <small>{step.help}</small>}
            </label>
          )}
          {step.secret && <StatusLine status={status} />}

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
        </div>

        <footer className="onboarding-actions">
          {index > 0 && (
            <button type="button" className="pill glass small" onClick={back}>
              Retour
            </button>
          )}
          {((step.secret && !saved && !verified) ||
            (step.key === 'notifications' && access === 'not-determined')) && (
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
