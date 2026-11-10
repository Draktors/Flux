import { BellRing, Check, CircleAlert, Settings2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { NotificationAccess, Settings, SettingsPatch } from '../../shared/types'

import { BrandIcon } from './Brand'

type TextKey = Exclude<keyof SettingsPatch, 'onboarded'>

const ACCESS_LABEL: Record<NotificationAccess, string> = {
  authorized: 'Autorisées par macOS',
  provisional: 'Autorisées par macOS, en mode discret',
  denied: 'Bloquées par macOS : active Flux dans les réglages',
  'not-determined': 'Pas encore autorisées',
  unsupported: 'Autorisation illisible, envoie un essai pour vérifier',
}

export function SettingsPanel({ onClose, onReplay }: { onClose(): void; onReplay(): void }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [patch, setPatch] = useState<SettingsPatch>({})
  const [saved, setSaved] = useState(false)
  const [access, setAccess] = useState<NotificationAccess | null>(null)

  useEffect(() => {
    void window.flux.getSettings().then(setSettings)
    // Back from System Settings, the window regains focus: read the permission again
    const refresh = () => void window.flux.notificationAccess().then(setAccess)
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  if (!settings) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await window.flux.saveSettings(patch)
    setPatch({})
    setSaved(true)
    setSettings(await window.flux.getSettings())
  }

  const field = (key: TextKey) => ({
    value: patch[key] ?? '',
    onChange: (event: { target: { value: string } }) => {
      setSaved(false)
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

      <label>
        <span className="label-title">
          <BrandIcon brand="linear" size={13} />
          Clef API Linear
        </span>
        <input
          type="password"
          autoComplete="off"
          placeholder={settings.hasLinearKey ? 'Enregistrée' : 'lin_api_…'}
          {...field('linearKey')}
        />
        <small>Linear → Settings → Security &amp; access → Personal API keys.</small>
      </label>

      <label>
        <span className="label-title">
          <BrandIcon brand="calendar" size={13} />
          Adresse iCal secrète de ton agenda
        </span>
        <input
          type="password"
          autoComplete="off"
          placeholder={settings.hasCalendarUrl ? 'Enregistrée' : 'https://calendar.google.com/…/basic.ics'}
          {...field('calendarUrl')}
        />
        <small>Google Agenda → Paramètres de ton agenda → Adresse secrète au format iCal.</small>
      </label>

      <label>
        Heure du daily
        <input
          type="time"
          value={patch.dailyTime ?? settings.dailyTime}
          onChange={field('dailyTime').onChange}
        />
      </label>

      <label>
        Raccourci de capture
        <input
          value={patch.captureShortcut ?? settings.captureShortcut}
          onChange={field('captureShortcut').onChange}
        />
      </label>

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
        {saved && <span role="status">Enregistré</span>}
        <button type="submit" className="pill solid small">
          Enregistrer
        </button>
      </footer>
    </form>
    </div>
  )
}
