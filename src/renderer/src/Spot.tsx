import { Pause, Play, Waves } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Rank } from '../../shared/types'
import { rankStyle, tint } from './rankStyle'
import { Stage } from './Stage'

// The presentation of what is new: one idea per scene, the silk changing colour at each cut
interface Scene {
  id: string
  rank: Rank
  ms: number
  kicker: string
  headline: string
  caption?: string
  body?: () => ReactNode
}

const LEAVE_MS = 700

function at(delay: number, extra: CSSProperties = {}): CSSProperties {
  return { '--d': `${delay}s`, ...extra } as CSSProperties
}

function Words({ text, delay = 0.25 }: { text: string; delay?: number }) {
  return (
    <h1 className="spot-headline" aria-label={text}>
      {text.split(' ').map((word, index) => (
        <span key={`${word}-${index}`} style={at(delay + index * 0.08)} aria-hidden="true">
          {word}
        </span>
      ))}
    </h1>
  )
}

function WrapupBody() {
  const rows = [
    ['Mergée', 'Étapes et bandeau vocal'],
    ['Review rendue', 'Filtre du planning'],
    ['Retours traités', 'Sortie de RxJS, lot 1'],
  ]
  return (
    <div className="spot-mock">
      <div className="spot-times">
        {['11:00', '14:30', '16:30'].map((time, index) => (
          <span key={time} className="spot-chip glass" style={at(1.3 + index * 0.18)}>
            {time}
          </span>
        ))}
      </div>
      <ul className="spot-panel glass" style={{ '--pd': '1.8s' } as CSSProperties}>
        {rows.map(([label, title], index) => (
          <li key={title} className="spot-row" style={at(2.1 + index * 0.16)}>
            <span className="spot-box" style={at(3.2 + index * 0.45)} />
            <span className="spot-title">{title}</span>
            <span className="spot-label">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function YesterdayBody() {
  const rows = [
    ['Mergée', 'Étapes et bandeau vocal', '#1595'],
    ['Review rendue', 'Filtre du planning', '#7001'],
    ['Question répondue', 'Format des pièces', 'OFF-1031'],
    ['Clos', 'Bandeau hors ligne', 'OFF-1030'],
  ]
  return (
    <ul className="spot-panel glass">
      {rows.map(([label, title, ref], index) => (
        <li key={title} className="spot-row wide" style={at(1.4 + index * 0.22)}>
          <span className="spot-kind">{label}</span>
          <span className="spot-title">{title}</span>
          <span className="spot-pill">{ref}</span>
        </li>
      ))}
    </ul>
  )
}

// The third intention climbs to the top: the rows end in their final order, the animation starts from the old one
function TodayBody() {
  const rows = [
    { title: 'Débloquer la review de Nicolas', from: '200%' },
    { title: 'Traiter les retours outbox', from: '-100%' },
    { title: 'Bandeau hors ligne du planning', from: '-100%' },
  ]
  return (
    <div className="spot-mock">
      <ol className="spot-panel glass spot-ordered" style={{ '--pd': '1s' } as CSSProperties}>
        <li className="spot-numbers" aria-hidden="true">
          {[1, 2, 3].map(number => (
            <span key={number} style={at(1.3 + number * 0.12)}>
              {number}
            </span>
          ))}
        </li>
        {rows.map((row, index) => (
          <li
            key={row.title}
            className={`spot-row spot-move${index === 0 ? ' lifted' : ''}`}
            style={at(1.4 + index * 0.12, { '--from': row.from } as CSSProperties)}
          >
            <span className="spot-grip" aria-hidden="true" />
            <span className="spot-title">{row.title}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function HealthBody() {
  const rows = [
    ['alert', 'Sentry', '2 régressions sur la sync'],
    ['ok', 'Datadog', 'Aucun monitor en alerte'],
    ['weak', 'Ximi', 'Rejets en hausse'],
    ['positive', 'Amplitude', 'Recueil vocal +32 %'],
  ]
  return (
    <ul className="spot-panel glass">
      {rows.map(([level, source, text], index) => (
        <li key={source} className={`spot-row health level-${level}`} style={at(1.4 + index * 0.35)}>
          <span className="spot-dot" style={at(1.6 + index * 0.35)} />
          <strong>{source}</strong>
          <span className="spot-title">{text}</span>
        </li>
      ))}
    </ul>
  )
}

function WaitingBody() {
  return (
    <div className="spot-mock spot-columns">
      {[
        { name: 'File', before: 4, after: 3 },
        { name: 'Attente', before: 2, after: 3 },
      ].map(column => (
        <div key={column.name} className="spot-column" style={at(1.2)}>
          <span className="spot-tab glass">
            {column.name}
            <span className="spot-count">
              <span className="before" style={at(3.3)}>
                {column.before}
              </span>
              <span className="after" style={at(3.3)}>
                {column.after}
              </span>
            </span>
          </span>
        </div>
      ))}
      <div className="spot-card glass" style={at(2.5)}>
        <span className="spot-pill">#6967</span>
        Grille VEB
        <small>Reviewée, attend l’auteur</small>
      </div>
    </div>
  )
}

function OutroBody() {
  return (
    <span className="spot-mark" style={at(0.2)}>
      <span className="boot-orbit" />
      <span className="boot-core glass">
        <Waves size={30} strokeWidth={2.2} />
      </span>
    </span>
  )
}

export const SCENES: Scene[] = [
  { id: 'intro', rank: 6, ms: 4200, kicker: 'Nouveau dans Flux', headline: 'Ta journée, en plus court.' },
  {
    id: 'wrapup',
    rank: 4,
    ms: 7000,
    kicker: 'Wrap-up',
    headline: 'Trois points. Rien d’oublié.',
    caption: 'Il remplace Dormant, à tes heures.',
    body: WrapupBody,
  },
  {
    id: 'yesterday',
    rank: 2,
    ms: 6000,
    kicker: 'Daily',
    headline: 'Hier, en une ligne.',
    body: YesterdayBody,
  },
  {
    id: 'today',
    rank: 1,
    ms: 7000,
    kicker: 'Daily',
    headline: 'Tes trois intentions.',
    caption: 'Glisse pour changer l’ordre. Le wrap-up suit.',
    body: TodayBody,
  },
  {
    id: 'health',
    rank: 3,
    ms: 6500,
    kicker: 'Santé prod',
    headline: 'La prod, d’un regard.',
    body: HealthBody,
  },
  {
    id: 'waiting',
    rank: 5,
    ms: 5500,
    kicker: 'Reviews',
    headline: 'Déjà reviewée ? Elle attend.',
    caption: 'Une nouvelle demande la ramène.',
    body: WaitingBody,
  },
  { id: 'outro', rank: 0, ms: 5000, kicker: 'Flux', headline: 'Tout ce qui t’attend. Rien de plus.', body: OutroBody },
]

function SceneView({ scene, leaving }: { scene: Scene; leaving: boolean }) {
  const Body = scene.body
  const outro = scene.id === 'outro'
  return (
    <div
      className={`spot-scene${leaving ? ' leaving' : ''}${outro ? ' outro' : ''}`}
      style={{ ...tint(rankStyle(scene.rank)), '--ms': `${scene.ms}ms` } as CSSProperties}
      aria-hidden={leaving}
    >
      <div className="spot-frame">
        {outro && Body && <Body />}
        <p className="spot-kicker" style={at(0.1)}>
          {scene.kicker}
        </p>
        <Words text={scene.headline} />
        {scene.caption && (
          <p className="spot-caption" style={at(0.9)}>
            {scene.caption}
          </p>
        )}
        {!outro && Body && <Body />}
      </div>
    </div>
  )
}

export function Spot({ start = 0, onEnd }: { start?: number; onEnd(): void }) {
  const [scene, setScene] = useState(start)
  const [leaving, setLeaving] = useState<number | null>(null)
  const [playing, setPlaying] = useState(true)
  // Bumped on every jump, so a scene played again starts its animations over
  const [take, setTake] = useState(0)
  const elapsed = useRef(0)
  const fills = useRef<Array<HTMLSpanElement | null>>([])

  const paint = useCallback((index: number, ratio: number) => {
    fills.current.forEach((fill, position) => {
      if (!fill) return
      const value = position < index ? 1 : position > index ? 0 : ratio
      fill.style.transform = `scaleX(${value})`
    })
  }, [])

  const go = useCallback(
    (index: number) => {
      if (index >= SCENES.length) {
        onEnd()
        return
      }
      const target = Math.max(0, index)
      setLeaving(current => (target === scene ? current : scene))
      setScene(target)
      setTake(value => value + 1)
      elapsed.current = 0
      paint(target, 0)
    },
    [scene, onEnd, paint],
  )

  useEffect(() => {
    if (leaving === null) return undefined
    const timer = setTimeout(() => setLeaving(null), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving, scene])

  useEffect(() => {
    if (!playing) return undefined
    let last = performance.now()
    let frame = 0
    const step = (now: number) => {
      elapsed.current += now - last
      last = now
      const ms = SCENES[scene].ms
      paint(scene, Math.min(1, elapsed.current / ms))
      if (elapsed.current >= ms) go(scene + 1)
      else frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, scene, go, paint])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A focused button answers Space itself
      if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        setPlaying(value => !value)
      } else if (event.key === 'ArrowRight') go(scene + 1)
      else if (event.key === 'ArrowLeft') go(elapsed.current > 1200 ? scene : scene - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scene, go])

  const current = SCENES[scene]
  return (
    <div className={`spot${playing ? '' : ' paused'}`}>
      <Stage style={rankStyle(current.rank)} drift={playing} />
      <div className="spot-veil" aria-hidden="true" />
      {/* The whole picture pauses on click, like a video; the button below does the same from the keyboard */}
      <div className="spot-surface" onClick={() => setPlaying(value => !value)}>
        {leaving !== null && <SceneView key={`out-${leaving}-${take}`} scene={SCENES[leaving]} leaving />}
        <SceneView key={`in-${scene}-${take}`} scene={current} leaving={false} />
      </div>

      <div className="spot-controls">
        <button
          type="button"
          className="round small glass"
          aria-label={playing ? 'Pause' : 'Lecture'}
          title="Espace"
          onClick={() => setPlaying(value => !value)}
        >
          {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
        <div className="spot-segments">
          {SCENES.map((entry, index) => (
            <button
              type="button"
              key={entry.id}
              aria-label={`${entry.kicker} : ${entry.headline}`}
              aria-current={index === scene ? 'step' : undefined}
              onClick={() => go(index)}
            >
              <span ref={element => void (fills.current[index] = element)} />
            </button>
          ))}
        </div>
        <button type="button" className="pill glass small" onClick={onEnd}>
          Passer
        </button>
      </div>
    </div>
  )
}
