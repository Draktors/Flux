import { ArrowLeft, Check, LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Settings, TrackedProject } from '../../shared/types'
import { ProjectsPicker } from './Projects'

// Changes land on their own: a short pause groups a burst of clicks into one save
const SAVE_DELAY_MS = 600

type SaveState = 'idle' | 'pending' | 'saved' | 'error'

// The Espaces page of the settings window: same window, its own content, saved as you go
export function WorkspacesView({
  onBack,
  onClose,
  onError,
}: {
  // Only when the page was reached from the settings; opened from the selector it stands alone
  onBack?: () => void
  onClose(): void
  onError(message: string): void
}) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [projects, setProjects] = useState<TrackedProject[] | null>(null)
  const [save, setSave] = useState<SaveState>('idle')
  const pending = useRef<TrackedProject[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void window.flux.getSettings().then(loaded => {
      setSettings(loaded)
      setProjects(loaded.projects ?? [])
    })
  }, [])

  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    if (!next) return
    window.flux
      .saveSettings({ projects: next })
      .then(() => setSave(current => (pending.current ? current : 'saved')))
      .catch(error => {
        setSave('error')
        onError(`Espaces non enregistrés : ${(error as Error).message}`)
      })
  }

  // Closing never loses the last change
  useEffect(() => flush, [])

  const change = (next: TrackedProject[]) => {
    setProjects(next)
    setSave('pending')
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  const leave = (then: () => void) => {
    flush()
    then()
  }

  return (
    <>
      <header className="settings-subheader">
        {onBack && (
          <button
            type="button"
            className="round glass small"
            aria-label="Retour aux réglages"
            title="Réglages"
            onClick={() => leave(onBack)}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        )}
        <h1>Espaces</h1>
        <span className={`save-state ${save}`} role="status">
          {save === 'pending' && <LoaderCircle size={13} className="spin" aria-hidden="true" />}
          {save === 'saved' && <Check size={13} aria-hidden="true" />}
          {save === 'pending' ? 'Enregistrement…' : save === 'saved' ? 'Enregistré' : ''}
        </span>
        <button
          type="button"
          className="round glass small"
          aria-label="Fermer"
          onClick={() => leave(onClose)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <small className="settings-hint">
        Chaque projet coché devient un espace, avec sa file et ses PR. Glisse-les pour
        changer l’ordre du sélecteur.
      </small>

      {settings && projects ? (
        <ProjectsPicker trackers={settings.trackers} value={projects} onChange={change} />
      ) : (
        <small className="projects-loading">
          <LoaderCircle size={13} className="spin" aria-hidden="true" />
          Chargement…
        </small>
      )}
    </>
  )
}
