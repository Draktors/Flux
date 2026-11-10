import { Play, RotateCcw, Sparkles, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { SCENES, Spot } from './Spot'

// Newest first, one line each: the id of the first entry marks what was read
const ENTRIES: Array<{ id: string; date: string; text: string; scene?: string }> = [
  { id: '2026-11-10-workspaces', date: '10 nov.', text: 'Un espace par projet Jira ou Linear', scene: 'workspaces' },
  { id: '2026-11-10-trackers', date: '10 nov.', text: 'Jira ou Linear en gestion de projet, au choix', scene: 'workspaces' },
  { id: '2026-11-10-github-accounts', date: '10 nov.', text: 'Plusieurs comptes GitHub, choisis dans les réglages' },
  { id: '2026-11-10-no-review', date: '10 nov.', text: 'Dépôts sans review : tes PR prêtes à livrer', scene: 'workspaces' },
  { id: '2026-11-10-daily-workspace', date: '10 nov.', text: 'Un daily par espace, avec commits, réunions et stand-up', scene: 'daily' },
  { id: '2026-11-10-calls', date: '10 nov.', text: 'Calls Granola rangés par type et par produit' },
  { id: '2026-11-10-daily', date: '10 nov.', text: 'Daily refait, en blocs courts', scene: 'daily' },
  { id: '2026-11-10-intentions', date: '10 nov.', text: 'Intentions du jour réordonnables', scene: 'daily' },
  { id: '2026-11-10-health', date: '10 nov.', text: 'Santé prod d’un regard', scene: 'daily' },
  { id: '2026-11-10-wrapup', date: '10 nov.', text: 'Wrap-up à la place de Dormant', scene: 'wrapup' },
  { id: '2026-11-10-reviewed', date: '10 nov.', text: 'PR reviewées rangées en Attente', scene: 'reviews' },
  { id: '2026-11-10-refresh', date: '10 nov.', text: 'Bouton Tout actualiser' },
  { id: '2026-11-09-flux', date: '9 nov.', text: 'Première version' },
]

const READ_KEY = 'flux.changelogRead'

function readMark(): string | null {
  try {
    return localStorage.getItem(READ_KEY)
  } catch {
    return null
  }
}

function saveMark(id: string): void {
  try {
    localStorage.setItem(READ_KEY, id)
  } catch {
    return
  }
}

type View = { kind: 'spot'; start: number } | { kind: 'list' }

function ChangelogModal({ onClose }: { onClose(): void }) {
  const [view, setView] = useState<View>({ kind: 'spot', start: 0 })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim spot-scrim" onClick={onClose}>
      <div
        className="spot-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Nouveautés"
        onClick={event => event.stopPropagation()}
      >
        <header className="spot-modal-head">
          <h2>Nouveautés</h2>
          <button type="button" className="round small glass" aria-label="Fermer" title="Échap" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        {view.kind === 'spot' ? (
          <Spot key={view.start} start={view.start} onEnd={() => setView({ kind: 'list' })} />
        ) : (
          <div className="spot-list">
            <ul>
              {ENTRIES.map((entry, index) => {
                const scene = SCENES.findIndex(item => item.id === entry.scene)
                return (
                  <li key={entry.id} style={{ '--n': index } as CSSProperties}>
                    <span className="spot-list-date">{entry.date}</span>
                    <span className="spot-list-text">{entry.text}</span>
                    {scene >= 0 && (
                      <button
                        type="button"
                        className="round small glass"
                        aria-label={`Voir : ${entry.text}`}
                        title="Voir la scène"
                        onClick={() => setView({ kind: 'spot', start: scene })}
                      >
                        <Play size={13} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            <button type="button" className="pill glass small" onClick={() => setView({ kind: 'spot', start: 0 })}>
              <RotateCcw size={14} aria-hidden="true" />
              Revoir la présentation
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function Changelog() {
  const [open, setOpen] = useState(false)
  const [read, setRead] = useState(readMark)
  const latest = ENTRIES[0].id

  return (
    <>
      <button
        type="button"
        className="round glass changelog"
        aria-label="Nouveautés"
        title="Nouveautés"
        onClick={() => {
          saveMark(latest)
          setRead(latest)
          setOpen(true)
        }}
      >
        <Sparkles size={16} aria-hidden="true" />
        {read !== latest && <span className="unread" aria-label="Nouveautés à voir" />}
      </button>
      {open && <ChangelogModal onClose={() => setOpen(false)} />}
    </>
  )
}
