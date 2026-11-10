import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DailyState } from '../../shared/types'
import { BrandIcon } from './Brand'
import { Prose } from './Markdown'

function Empty({ daily }: { daily: DailyState }) {
  if (daily.status === 'running') return <p className="daily-state">Le daily se prépare.</p>
  if (daily.status === 'error') {
    return <p className="daily-state error">Le daily a échoué : {daily.error}</p>
  }
  return <p className="daily-state">Pas encore de daily aujourd'hui.</p>
}

export function DailyView({ daily }: { daily: DailyState }) {
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void window.flux.readDaily().then(setNote)
  }, [daily.status, daily.date])

  return (
    <main className="daily">
      <div className="daily-sheet glass-dark">
        <header>
          <button
            type="button"
            className="pill glass small"
            disabled={daily.status === 'running'}
            onClick={() => void window.flux.runDaily()}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {note ? 'Relancer' : 'Lancer le daily'}
          </button>
          {note && (
            <button type="button" className="pill glass small" onClick={() => void window.flux.openDaily()}>
              <BrandIcon brand="obsidian" size={14} />
              Ouvrir dans Obsidian
            </button>
          )}
        </header>
        {note ? (
          <Prose source={note} />
        ) : (
          <Empty daily={daily} />
        )}
      </div>
    </main>
  )
}
