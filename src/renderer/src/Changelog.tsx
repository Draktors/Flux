import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Newest first, one line each: the id of the first entry marks what was read
const ENTRIES: Array<{ id: string; date: string; text: string }> = [
  { id: '2026-11-10-daily', date: '10 nov.', text: 'Daily refait, en blocs courts' },
  { id: '2026-11-10-wrapup', date: '10 nov.', text: 'Wrap-up à la place de Dormant' },
  { id: '2026-11-10-reviewed', date: '10 nov.', text: 'PR reviewées rangées en Attente' },
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

export function Changelog() {
  const [open, setOpen] = useState(false)
  const [read, setRead] = useState(readMark)
  const root = useRef<HTMLDivElement>(null)
  const latest = ENTRIES[0].id

  useEffect(() => {
    if (!open) return undefined
    saveMark(latest)
    setRead(latest)
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, latest])

  return (
    <div className="changelog" ref={root}>
      <button
        type="button"
        className="round glass"
        aria-label="Nouveautés"
        aria-expanded={open}
        title="Nouveautés"
        onClick={() => setOpen(value => !value)}
      >
        <Sparkles size={16} aria-hidden="true" />
        {read !== latest && <span className="unread" aria-label="Nouveautés à lire" />}
      </button>
      {open && (
        <div className="changelog-pop glass" role="dialog" aria-label="Nouveautés">
          <ul>
            {ENTRIES.map(entry => (
              <li key={entry.id}>
                <span>{entry.date}</span>
                {entry.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
