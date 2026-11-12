import { Bot } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { RANKS } from '../../shared/ranks'
import type { Item, Rank, TopicView } from '../../shared/types'
import { LinkIcon } from './Brand'
import { displayTitle, waitingFor } from './format'
import { rankStyle, tint } from './rankStyle'

// « Mes sujets »
const MINE: Rank = 6

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

export const looseId = (item: Item) => `loose:${item.ref}`

interface LooseCardProps {
  item: Item
  selected: boolean
  onSelect(id: string): void
}

function LooseCard({ item, selected, onSelect }: LooseCardProps) {
  const element = useRef<HTMLButtonElement>(null)

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
      style={tint(rankStyle(null))}
      onClick={() => onSelect(looseId(item))}
    >
      <span className="card-head">
        <strong className="card-link">
          <LinkIcon url={item.url} size={12} />
          {item.ref}
        </strong>
      </span>
      <span className="card-title">{displayTitle(item.title)}</span>
    </button>
  )
}

export interface SprintScope {
  only: boolean
  // Cards the sprint filter takes out, for the switch's tooltip
  hidden: number
  onChange(only: boolean): void
}

function SprintSwitch({ scope }: { scope: SprintScope }) {
  return (
    <span className="scope-switch" role="group" aria-label="Tickets montrés">
      {[
        { only: true, label: 'Sprint', title: 'Seulement les tickets du sprint en cours' },
        {
          only: false,
          label: 'Tout',
          title: scope.only && scope.hidden > 0 ? `Aussi ${scope.hidden} hors sprint` : 'Tous tes tickets assignés',
        },
      ].map(option => (
        <button
          key={option.label}
          type="button"
          aria-pressed={scope.only === option.only}
          title={option.title}
          onClick={() => scope.onChange(option.only)}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}

function Group({
  label,
  rank,
  extra,
  children,
}: {
  label?: string
  rank?: Rank
  extra?: ReactNode
  children: ReactNode
}) {
  const style = rank === undefined ? null : rankStyle(rank)
  const Icon = style?.icon
  return (
    <div className="rail-group">
      {label && (
        <h2 style={style ? tint(style) : undefined}>
          {Icon && <Icon size={13} strokeWidth={2.4} aria-hidden="true" />}
          {label}
          {extra}
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
  // The Sprint / Tout switch beside « Mes sujets », once Jira tells which tickets are in it
  sprint?: SprintScope
  selected: string | null
  isFresh(view: TopicView): boolean
  onSelect(id: string): void
}

export function Rail({ views, loose = [], grouped, sprint, selected, isFresh, onSelect }: RailProps) {
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
  const shown = [...new Set(views.map(view => view.rank))].filter((rank): rank is Rank => rank !== null)
  // A sprint with nothing of yours left keeps its header, so « Tout » stays at hand
  const ranks =
    sprint && sprint.hidden > 0 && !shown.includes(MINE) ? [...shown, MINE].sort((a, b) => a - b) : shown

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
            <Group
              key={rank}
              label={RANKS[rank].label}
              rank={rank}
              extra={rank === MINE && sprint ? <SprintSwitch scope={sprint} /> : undefined}
            >
              {views.filter(view => view.rank === rank).map(card)}
              {rank === MINE && sprint && !views.some(view => view.rank === MINE) && (
                <p className="rail-empty">Rien d’autre pour toi dans le sprint.</p>
              )}
            </Group>
          ))
        ) : (
          <Group>{views.map(card)}</Group>
        )}
        {loose.length > 0 && (
          <Group label="En attente">
            {loose.map(item => (
              <LooseCard
                key={item.ref}
                item={item}
                selected={looseId(item) === selected}
                onSelect={onSelect}
              />
            ))}
          </Group>
        )}
      </div>
    </nav>
  )
}
