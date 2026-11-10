import { ArrowUpRight, Check, PenLine } from 'lucide-react'
import { useState } from 'react'
import type { ThreadStatus, TopicView } from '../../shared/types'
import { BrandIcon, brandOf } from './Brand'
import { displayTitle } from './format'
import { Prose } from './Markdown'
import { useDraft } from './useDraft'

const THREAD_LABEL: Record<ThreadStatus, string> = {
  busy: 'Au travail',
  idle: 'T’attend',
  closed: 'Fermé',
  pending: 'Démarre dans Claude',
}

export function Inspector({ view }: { view: TopicView }) {
  const { topic } = view
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useDraft(topic.body, next =>
    void window.flux.updateTopic(topic.id, { body: next }),
  )

  const goTo = (session: string) => {
    setError(null)
    window.flux
      .focusThread(topic.id, session)
      .catch((failure: Error) => setError(failure.message.replace(/^Error invoking.*?: /, '')))
  }

  return (
    <aside className="inspector glass-dark" key={topic.id}>
      {view.threads.length > 0 && (
        <section>
          <h2>Threads</h2>
          <ul className="rows">
            {view.threads.map(thread => (
              <li key={thread.session}>
                <span className={`state ${thread.status}`} aria-hidden="true" />
                <span className="row-text">
                  <strong>{thread.name.replace(/^flux · /, '')}</strong>
                  <small>
                    {THREAD_LABEL[thread.status]}
                    {thread.closing ? ', à fermer' : ''}
                  </small>
                </span>
                <button
                  type="button"
                  className="pill glass small"
                  title="Ouvrir dans Claude"
                  onClick={() => goTo(thread.session)}
                >
                  <BrandIcon brand="claude" size={13} />
                  {thread.status === 'closed' ? 'Reprendre' : 'Y aller'}
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p className="hero-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}

      {view.items.length > 0 && (
        <section>
          <h2>Liens</h2>
          <ul className="rows">
            {view.items.map(item => (
              <li key={item.ref}>
                <button
                  type="button"
                  className="row-link"
                  onClick={() => void window.flux.openExternal(item.url)}
                >
                  <span className={`kind ${item.kind}`}>
                    <BrandIcon
                      brand={brandOf(item.url) ?? (item.kind === 'pr' ? 'github' : 'linear')}
                      size={14}
                    />
                  </span>
                  <span className="row-text">
                    <strong>{item.ref}</strong>
                    <small>{displayTitle(item.title)}</small>
                  </span>
                  <ArrowUpRight size={15} aria-hidden="true" className="row-go" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="note">
        <header className="note-head">
          <h2>Note</h2>
          {body.trim() && (
            <button
              type="button"
              className="ghost"
              aria-label={editing ? 'Terminer' : 'Modifier la note'}
              title={editing ? 'Terminer' : 'Modifier'}
              // Keeps the textarea focused, so its blur does not race this toggle
              onMouseDown={event => event.preventDefault()}
              onClick={() => setEditing(current => !current)}
            >
              {editing ? <Check size={14} aria-hidden="true" /> : <PenLine size={14} aria-hidden="true" />}
            </button>
          )}
        </header>
        {editing || !body.trim() ? (
          <textarea
            aria-label="Note du sujet"
            value={body}
            autoFocus={editing}
            placeholder="Contexte, décisions, ce que le thread doit savoir. Le Markdown est rendu."
            onChange={event => setBody(event.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={event => {
              if (event.key === 'Escape') event.currentTarget.blur()
            }}
          />
        ) : (
          <div
            className="note-view"
            role="button"
            tabIndex={0}
            title="Cliquer pour modifier"
            onClick={() => setEditing(true)}
            onKeyDown={event => {
              if (event.key === 'Enter') setEditing(true)
            }}
          >
            <Prose source={body} className="prose note-prose" />
          </div>
        )}
      </section>
    </aside>
  )
}
