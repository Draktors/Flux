import { X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { Settings, SettingsPatch } from '../../shared/types'

type TextKey = Exclude<keyof SettingsPatch, 'onboarded'>

export function SettingsPanel({ onClose, onReplay }: { onClose(): void; onReplay(): void }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [patch, setPatch] = useState<SettingsPatch>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void window.flux.getSettings().then(setSettings)
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
        Clef API Linear
        <input
          type="password"
          autoComplete="off"
          placeholder={settings.hasLinearKey ? 'Enregistrée' : 'lin_api_…'}
          {...field('linearKey')}
        />
        <small>Linear → Settings → Security &amp; access → Personal API keys.</small>
      </label>

      <label>
        Adresse iCal secrète de ton agenda
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
        {saved && <span role="status">Enregistré</span>}
        <button type="submit" className="pill solid small">
          Enregistrer
        </button>
      </footer>
    </form>
    </div>
  )
}
