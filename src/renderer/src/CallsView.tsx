import { CircleAlert, ExternalLink, LoaderCircle, Mic, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CALL_TYPES, callTypeLabel, type CallsState, type CallView } from '../../shared/calls'
import type { WorkspaceInfo } from '../../shared/types'
import { clock } from './format'
import { Prose } from './Markdown'

type Scope = 'workspace' | 'all'

function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (days === 0) return 'Aujourd’hui'
  if (days === 1) return 'Hier'
  const label = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function groupByDay(calls: CallView[]): Array<[string, CallView[]]> {
  const groups = new Map<string, CallView[]>()
  for (const call of calls) {
    const label = dayLabel(call.at)
    groups.set(label, [...(groups.get(label) ?? []), call])
  }
  return [...groups.entries()]
}

function sourceLabel(call: CallView, field: 'type' | 'workspace'): string {
  const source = field === 'type' ? call.typeSource : call.workspaceSource
  if (source === 'you') return 'Choisi par toi'
  if (source === 'title') return 'Lu dans le titre'
  if (source === 'claude') return 'Déduit du résumé'
  return field === 'workspace' ? 'Semaine prévue dans l’alternance' : 'À préciser'
}

function Connect({ state }: { state: CallsState }) {
  const { granola } = state
  return (
    <div className="calls-empty">
      <span className="calls-empty-icon">
        <Mic size={22} aria-hidden="true" />
      </span>
      <h1>Tes calls Granola, rangés.</h1>
      <p>
        Flux lit les résumés de tes appels des 30 derniers jours, les classe par type (daily, planning,
        rétro, point IA…) et par produit, et te laisse corriger.
      </p>
      {granola.error && (
        <p className="calls-error">
          <CircleAlert size={15} aria-hidden="true" />
          {granola.error}
        </p>
      )}
      <button
        type="button"
        className="pill solid"
        disabled={granola.connecting}
        onClick={() => void window.flux.connectGranola().catch(() => undefined)}
      >
        {granola.connecting ? (
          <>
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
            Termine la connexion dans ton navigateur
          </>
        ) : (
          'Connecter Granola'
        )}
      </button>
    </div>
  )
}

function Detail({ call, workspaces }: { call: CallView; workspaces: WorkspaceInfo[] }) {
  return (
    <article className="call-detail" key={call.id}>
      <header>
        <p className="call-when">
          {dayLabel(call.at)} · {clock(call.at)}
        </p>
        <h1>{call.title}</h1>
        {call.participants.length > 0 && <p className="call-people">{call.participants.join(', ')}</p>}
      </header>

      <div className="call-fields">
        <div className="call-field">
          <span>
            Type <small>{sourceLabel(call, 'type')}</small>
          </span>
          <div className="call-chips" role="radiogroup" aria-label="Type d’appel">
            {CALL_TYPES.map(type => (
              <button
                key={type.id}
                type="button"
                role="radio"
                aria-checked={call.type === type.id}
                className="call-chip"
                onClick={() => void window.flux.updateCall(call.id, { type: type.id })}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {workspaces.length > 1 && (
          <div className="call-field">
            <span>
              Produit <small>{sourceLabel(call, 'workspace')}</small>
            </span>
            <div className="call-chips" role="radiogroup" aria-label="Produit">
              {workspaces.map(workspace => (
                <button
                  key={workspace.id}
                  type="button"
                  role="radio"
                  aria-checked={call.workspace === workspace.id}
                  className="call-chip"
                  title={workspace.label}
                  onClick={() => void window.flux.updateCall(call.id, { workspace: workspace.id })}
                >
                  {workspace.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {call.uncertain && (
          <button
            type="button"
            className="pill glass small call-confirm"
            onClick={() =>
              void window.flux.updateCall(call.id, {
                type: call.type,
                ...(call.workspace ? { workspace: call.workspace } : {}),
              })
            }
          >
            <Sparkles size={14} aria-hidden="true" />
            C’est bon, valider
          </button>
        )}
      </div>

      <div className="call-summary">
        <button type="button" className="pill glass small" onClick={() => void window.flux.openExternal(call.url)}>
          <ExternalLink size={14} aria-hidden="true" />
          Ouvrir dans Granola
        </button>
        {call.summary ? (
          <Prose source={call.summary} className="prose call-prose" />
        ) : (
          <p className="calls-muted">Granola n’a pas encore de résumé pour cet appel.</p>
        )}
      </div>
    </article>
  )
}

export function CallsView({
  state,
  workspace,
  workspaces,
}: {
  state: CallsState
  workspace: string | null
  workspaces: WorkspaceInfo[]
}) {
  const [scope, setScope] = useState<Scope>('workspace')
  const [selected, setSelected] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const short = (id: string | null) => workspaces.find(entry => entry.id === id)?.short ?? null
  const active = workspaces.find(entry => entry.id === workspace)

  // Doubtful calls stay visible from both workspaces, so they get sorted out
  const calls = useMemo(
    () =>
      scope === 'all' || !workspace
        ? state.calls
        : state.calls.filter(call => call.workspace === workspace || call.uncertain),
    [state.calls, scope, workspace],
  )
  const current = calls.find(call => call.id === selected) ?? calls[0]
  const doubtful = state.calls.filter(call => call.uncertain).length

  useEffect(() => {
    if (selected && !calls.some(call => call.id === selected)) setSelected(null)
  }, [calls, selected])

  if (!state.granola.connected) {
    return (
      <main className="calls">
        <div className="calls-sheet glass-dark">
          <Connect state={state} />
        </div>
      </main>
    )
  }

  const sync = () => {
    setSyncing(true)
    void window.flux.syncCalls().finally(() => setSyncing(false))
  }

  return (
    <main className="calls">
      <div className="calls-sheet glass-dark">
        <aside className="calls-list">
          <header>
            {workspaces.length > 1 && (
              <div className="calls-scope" role="radiogroup" aria-label="Calls affichés">
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === 'workspace'}
                  onClick={() => setScope('workspace')}
                >
                  {active?.short ?? 'Espace'}
                </button>
                <button type="button" role="radio" aria-checked={scope === 'all'} onClick={() => setScope('all')}>
                  Tous
                </button>
              </div>
            )}
            {doubtful > 0 && <span className="calls-doubt">{doubtful} à vérifier</span>}
            <button
              type="button"
              className="round glass small"
              aria-label="Relire Granola"
              title="Relire Granola"
              disabled={syncing}
              onClick={sync}
            >
              <RefreshCw size={14} aria-hidden="true" className={syncing ? 'spin' : undefined} />
            </button>
          </header>

          {state.granola.error && (
            <p className="calls-error small">
              <CircleAlert size={14} aria-hidden="true" />
              {state.granola.error}
            </p>
          )}

          <div className="calls-scroll">
            {calls.length === 0 && <p className="calls-muted">Aucun call sur les 30 derniers jours.</p>}
            {groupByDay(calls).map(([day, entries]) => (
              <section key={day}>
                <h2>{day}</h2>
                {entries.map(call => (
                  <button
                    key={call.id}
                    type="button"
                    className="call-row"
                    aria-current={call.id === current?.id ? 'true' : undefined}
                    onClick={() => setSelected(call.id)}
                  >
                    <span className="call-row-head">
                      <span className="call-time">{clock(call.at)}</span>
                      <span className={`call-type type-${call.type}`}>{callTypeLabel(call.type)}</span>
                      {short(call.workspace) && workspaces.length > 1 && (
                        <span className="call-ws">{short(call.workspace)}</span>
                      )}
                      {call.uncertain && (
                        <span className="call-doubt" title="Classement à vérifier">
                          <CircleAlert size={13} aria-label="À vérifier" />
                        </span>
                      )}
                    </span>
                    <span className="call-row-title">{call.title}</span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </aside>

        {current ? (
          <Detail call={current} workspaces={workspaces} />
        ) : (
          <div className="call-detail calls-muted">Choisis un call.</div>
        )}
      </div>
    </main>
  )
}
