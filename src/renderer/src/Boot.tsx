import { Check, CircleAlert, LoaderCircle, Minus, Waves } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'

import type { Rank, Settings, SourceName } from '../../shared/types'

import { BrandIcon, type Brand } from './Brand'
import { rankStyle, tint } from './rankStyle'
import { Stage } from './Stage'

// The palette walks through the rank colours while the first sync runs
const SCENES: Rank[] = [6, 2, 5, 3, 4, 1]
const SCENE_MS = 2400
const TITLE = 'Chargement de votre espace'

const SOURCES: Array<{ name: SourceName; label: string; brand: Brand }> = [
  { name: 'github', label: 'Pull requests', brand: 'github' },
  { name: 'linear', label: 'Tickets', brand: 'linear' },
  { name: 'calendar', label: 'Agenda', brand: 'calendar' },
  { name: 'agents', label: 'Sessions Claude', brand: 'claude' },
]

export type BootProgress = Partial<Record<SourceName, boolean>>

type SourceState = 'loading' | 'ok' | 'error' | 'off'

function sourceState(
  name: SourceName,
  progress: BootProgress,
  settings: Settings | null,
): SourceState {
  if (name in progress) return progress[name] ? 'ok' : 'error'
  if (name === 'linear' && settings && !settings.hasLinearKey) return 'off'
  if (name === 'calendar' && settings && !settings.hasCalendarUrl) return 'off'
  return 'loading'
}

const STATE_LABEL: Record<SourceState, string> = {
  loading: 'En cours',
  ok: 'Prêt',
  error: 'Indisponible',
  off: 'Non connecté',
}

function StateIcon({ state }: { state: SourceState }) {
  if (state === 'loading') return <LoaderCircle size={14} className="spin" aria-hidden="true" />
  if (state === 'ok') return <Check size={14} aria-hidden="true" />
  if (state === 'error') return <CircleAlert size={14} aria-hidden="true" />
  return <Minus size={14} aria-hidden="true" />
}

export function Boot({
  leaving,
  progress,
  settings,
}: {
  leaving: boolean
  progress: BootProgress
  settings: Settings | null
}) {
  const [scene, setScene] = useState(0)
  const style = rankStyle(SCENES[scene])

  useEffect(() => {
    const timer = setInterval(() => setScene(current => (current + 1) % SCENES.length), SCENE_MS)
    return () => clearInterval(timer)
  }, [])

  const states = SOURCES.map(source => sourceState(source.name, progress, settings))
  const settled = states.filter(state => state !== 'loading').length
  const ratio = leaving ? 1 : (settled + 0.4) / (SOURCES.length + 1)

  return (
    <div
      className={`boot-screen${leaving ? ' leaving' : ''}`}
      style={tint(style)}
      role="status"
      aria-live="polite"
      aria-busy={!leaving}
    >
      <Stage style={style} drift />
      <div className="boot-veil" aria-hidden="true" />

      <div className="boot-content">
        <span className="boot-mark" aria-hidden="true">
          <span className="boot-orbit" />
          <span className="boot-core glass">
            <Waves size={30} strokeWidth={2.2} />
          </span>
        </span>

        <h1 className="boot-title" aria-label={TITLE}>
          {TITLE.split(' ').map((word, index) => (
            <span key={word} style={{ '--i': index } as CSSProperties} aria-hidden="true">
              {word}
            </span>
          ))}
        </h1>
        <p className="boot-sub">On rassemble tes PR, tes tickets et tes réunions.</p>

        <div className="boot-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${ratio})` }} />
        </div>

        <ul className="boot-sources">
          {SOURCES.map((source, index) => (
            <li
              key={source.name}
              className={states[index]}
              style={{ '--i': index } as CSSProperties}
            >
              <BrandIcon brand={source.brand} size={14} />
              <span>{source.label}</span>
              <small>
                <StateIcon state={states[index]} />
                {STATE_LABEL[states[index]]}
              </small>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
