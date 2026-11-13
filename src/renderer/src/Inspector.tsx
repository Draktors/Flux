import { ArrowUpRight, Check, PenLine } from 'lucide-react'
import { useState } from 'react'
import type { ThreadStatus, ThreadView, TopicView } from '../../shared/types'
import { BrandIcon, brandOf } from './Brand'
import { displayTitle } from './format'
import { Prose } from './Markdown'
import { useDraft } from './useDraft'

const THREAD_LABEL: Record<ThreadStatus, string> = {
  busy: 'Au travail',
  idle: 'T’attend',
  paused: 'En pause dans Claude',
  archived: 'Archivée dans Claude',
  closed: 'Fermée',
  pending: 'Démarre dans Claude',
}

const THREAD_HINT: Record<ThreadStatus, string> = {
  busy: 'Ouvrir la conversation dans Claude',
  idle: 'Ouvrir la conversation dans Claude',
  paused: 'Rouvrir la conversation dans Claude, qui la relance',
  archived: 'Claude la rouvre en nouvelle session, avec tout l’historique',
  closed: 'Reprendre la conversation dans Claude',
  pending: 'Relancer la demande dans Claude',
}

const threadTitle = (thread: ThreadView) => thread.title || thread.name.replace(/^flux · /, '')

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
      {(view.threads.length > 0 || view.items.length > 0) && (
        <section>
          <h2>Liens</h2>
          <ul className="rows">
            {view.threads.map(thread => (
              <li key={thread.desktop ?? thread.session}>
                <button
                  type="button"
                  className="row-link"
                  title={THREAD_HINT[thread.status]}
                  onClick={() => goTo(thread.desktop ?? thread.session)}
                >
                  <span className="kind conversation">
                    <BrandIcon brand="claude" size={14} />
                  </span>
                  <span className="row-text">
                    <strong>{threadTitle(thread)}</strong>
                    <small className="thread-status">
                      <span className={`state ${thread.status}`} aria-hidden="true" />
                      {THREAD_LABEL[thread.status]}
                      {thread.closing ? ', à fermer' : ''}
                    </small>
                  </span>
                  <ArrowUpRight size={15} aria-hidden="true" className="row-go" />
                </button>
              </li>
            ))}
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
          {error && (
            <p className="hero-error" role="alert">
              {error}
            </p>
          )}
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
