import { useEffect, useState } from 'react'
import { RANKS } from '../../shared/ranks'
import type { WrapupDone, WrapupFocus, WrapupOutcome, WrapupView as Wrapup } from '../../shared/types'
import { clock, displayTitle, waitingFor } from './format'
import { menuOfLine, showMenu } from './navigation'
import { rankStyle } from './rankStyle'

const OUTCOME: Record<WrapupOutcome, string> = {
  merged: 'Mergée',
  closed: 'Clos',
  handled: 'Traité',
  ticked: 'Coché',
}

const LOCKED_HINT = 'Confirmé par la source, rien à décocher'

interface RowProps {
  line: WrapupDone | WrapupFocus
  checked: boolean
  locked: boolean
  meta: string | null
  side: string | null
  accent?: string
  onCheck(done: boolean): void
  onOpen(): void
}

function Row({ line, checked, locked, meta, side, accent, onCheck, onOpen }: RowProps) {
  const openable = line.live || line.url !== null
  return (
    <li className={`check-row${checked ? ' done' : ''}`} onContextMenu={event => showMenu(event, menuOfLine(line))}>
      <input
        type="checkbox"
        className="check-box"
        checked={checked}
        disabled={locked}
        title={locked ? LOCKED_HINT : undefined}
        aria-label={displayTitle(line.title)}
        onChange={event => onCheck(event.target.checked)}
      />
      <button type="button" className="check-main" disabled={!openable} onClick={onOpen}>
        <span className="check-title">
          {line.ref && (
            <span className="check-ref" style={accent ? { color: accent } : undefined}>
              {line.ref}
            </span>
          )}
          {displayTitle(line.title)}
        </span>
        {meta && <span className="check-meta">{meta}</span>}
      </button>
      {side && <span className="check-side">{side}</span>}
    </li>
  )
}

function focusHeading(wrapup: Wrapup): string {
  if (wrapup.next) return `Focus d’ici ${wrapup.next}`
  return wrapup.slot ? 'Focus pour demain' : 'Focus'
}

function subtitle(wrapup: Wrapup): string {
  const count = wrapup.done.length
  const done = count === 0 ? 'Rien de bouclé pour l’instant' : `${count} ${count > 1 ? 'tâches bouclées' : 'tâche bouclée'} aujourd’hui`
  const when = wrapup.next ? `prochain point à ${wrapup.next}` : wrapup.slot ? 'dernier point du jour' : null
  return [done, when].filter(Boolean).join(' · ')
}

export function WrapupView({ wrapup, onOpen }: { wrapup: Wrapup; onOpen(topicId: string): void }) {
  // The box answers at once; the state pushed back by the main process takes over
  const [pending, setPending] = useState<Record<string, boolean>>({})
  useEffect(() => setPending({}), [wrapup])

  const check = (id: string, done: boolean) => {
    setPending(current => ({ ...current, [id]: done }))
    void window.flux.checkWrapup(id, done).catch(() => setPending({}))
  }
  const open = (line: WrapupDone | WrapupFocus) => {
    if (line.live && line.topicId) onOpen(line.topicId)
    else if (line.url) void window.flux.openExternal(line.url)
  }

  return (
    <main className="page">
      <div className="page-column wrapup">
        <header className="wrapup-head">
          <h1>{wrapup.slot ? `Wrap-up de ${wrapup.slot}` : 'Wrap-up'}</h1>
          <p>{subtitle(wrapup)}</p>
        </header>

        <section className="wrapup-section" aria-labelledby="wrapup-done">
          <h2 id="wrapup-done">
            Fait aujourd’hui
            {wrapup.done.length > 0 && <span className="count">{wrapup.done.length}</span>}
          </h2>
          {wrapup.done.length === 0 ? (
            <p className="wrapup-empty">Rien encore. Coche un focus dès qu’il est bouclé.</p>
          ) : (
            <ul className="checklist">
              {wrapup.done.map(line => (
                <Row
                  key={line.id}
                  line={line}
                  checked={pending[line.id] ?? true}
                  locked={line.locked}
                  meta={line.detail}
                  side={`${OUTCOME[line.outcome]} à ${clock(line.at)}`}
                  onCheck={done => check(line.id, done)}
                  onOpen={() => open(line)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="wrapup-section" aria-labelledby="wrapup-focus">
          <h2 id="wrapup-focus">{focusHeading(wrapup)}</h2>
          {wrapup.focus.length === 0 ? (
            <p className="wrapup-empty">Rien ne t’attend dans la file.</p>
          ) : (
            <ul className="checklist">
              {wrapup.focus.map(line => (
                <Row
                  key={line.id}
                  line={line}
                  checked={pending[line.id] ?? false}
                  locked={false}
                  meta={[line.rank === null ? null : RANKS[line.rank].label, line.detail]
                    .filter(Boolean)
                    .join(' · ')}
                  side={line.since ? waitingFor(line.since) : null}
                  accent={rankStyle(line.rank).light}
                  onCheck={done => check(line.id, done)}
                  onOpen={() => open(line)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
