import { Bot } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { RANKS } from '../../shared/ranks'
import type { Item, Rank, TopicView } from '../../shared/types'
import { displayTitle, waitingFor } from './format'
import { rankStyle, tint } from './rankStyle'

interface CardProps {
  view: TopicView
  selected: boolean
  fresh: boolean
  onSelect(id: string): void
}

function Card({ view, selected, fresh, onSelect }: CardProps) {
  const element = useRef<HTMLButtonElement>(null)
  const busy = view.threads.some(thread => thread.status === 'busy')
  const ref = view.topic.links[0] ?? 'Note'

  useEffect(() => {
    if (selected) {
      element.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
    }
  }, [selected])

  return (
    <button
      ref={element}
      type="button"
      className="card"
      aria-current={selected ? 'true' : undefined}
      style={tint(rankStyle(view.rank))}
      onClick={() => onSelect(view.topic.id)}
    >
      {fresh && <span className="badge">Nouveau</span>}
      <span className="card-head">
        <strong>{ref}</strong>
        {busy && <Bot size={14} aria-label="Agent au travail" />}
        <span className="age">{waitingFor(view.since)}</span>
      </span>
      <span className="card-title">{view.topic.blocked ?? displayTitle(view.topic.title)}</span>
    </button>
  )
}

function LooseCard({ item }: { item: Item }) {
  return (
    <button
      type="button"
      className="card"
      style={tint(rankStyle(null))}
      onClick={() => void window.flux.openExternal(item.url)}
    >
      <span className="card-head">
        <strong>{item.ref}</strong>
      </span>
      <span className="card-title">{displayTitle(item.title)}</span>
    </button>
  )
}

function Group({ label, rank, children }: { label?: string; rank?: Rank; children: ReactNode }) {
  const style = rank === undefined ? null : rankStyle(rank)
  const Icon = style?.icon
  return (
    <div className="rail-group">
      {label && (
        <h2 style={style ? tint(style) : undefined}>
          {Icon && <Icon size={13} strokeWidth={2.4} aria-hidden="true" />}
          {label}
        </h2>
      )}
      <div className="rail-cards">{children}</div>
    </div>
  )
}

interface RailProps {
  views: TopicView[]
  loose?: Item[]
  grouped: boolean
  selected: string | null
  isFresh(view: TopicView): boolean
  onSelect(id: string): void
}

export function Rail({ views, loose = [], grouped, selected, isFresh, onSelect }: RailProps) {
  const track = useRef<HTMLDivElement>(null)
  const card = (view: TopicView) => (
    <Card
      key={view.topic.id}
      view={view}
      selected={view.topic.id === selected}
      fresh={isFresh(view)}
      onSelect={onSelect}
    />
  )
  const ranks = [...new Set(views.map(view => view.rank))].filter(
    (rank): rank is Rank => rank !== null,
  )

  return (
    <nav className="rail" aria-label="Sujets dans l'ordre du flux">
      <div
        className="rail-track"
        ref={track}
        onWheel={event => {
          if (track.current && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            track.current.scrollLeft += event.deltaY
          }
        }}
      >
        {grouped ? (
          ranks.map(rank => (
            <Group key={rank} label={RANKS[rank].label} rank={rank}>
              {views.filter(view => view.rank === rank).map(card)}
            </Group>
          ))
        ) : (
          <Group>{views.map(card)}</Group>
        )}
        {loose.length > 0 && (
          <Group label="En attente">
            {loose.map(item => (
              <LooseCard key={item.ref} item={item} />
            ))}
          </Group>
        )}
      </div>
    </nav>
  )
}
