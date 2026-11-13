import { ArrowLeft, Check, LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  defaultRole,
  STATUS_ROLE_LABEL,
  STATUS_ROLES,
  statusKey,
  type StatusOptions,
  type StatusRole,
  type StatusRules,
  type TrackerStatus,
} from '../../shared/statuses'

// Same rhythm as the Espaces page: a burst of changes lands as one save
const SAVE_DELAY_MS = 600
// A board read left to right
const TYPE_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'duplicate']

type SaveState = 'idle' | 'pending' | 'saved' | 'error'

// Listing statuses takes a moment: keep the last answer while the panel comes and goes
let lastOptions: StatusOptions | null = null

function ordered(statuses: TrackerStatus[]): TrackerStatus[] {
  const rank = (type: string) => {
    const index = TYPE_ORDER.indexOf(type)
    return index === -1 ? TYPE_ORDER.length : index
  }
  return statuses
    .map((status, index) => ({ status, index }))
    .sort((a, b) => rank(a.status.type) - rank(b.status.type) || a.index - b.index)
    .map(({ status }) => status)
}

// The Statuts page of the settings: what each status of your tools means for Flux
export function StatusesView({
  onBack,
  onClose,
  onError,
}: {
  onBack(): void
  onClose(): void
  onError(message: string): void
}) {
  const [options, setOptions] = useState<StatusOptions | null>(lastOptions)
  const [rules, setRules] = useState<StatusRules | null>(null)
  const [save, setSave] = useState<SaveState>('idle')
  const pending = useRef<StatusRules | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void window.flux.getSettings().then(loaded => setRules(loaded.statusRules ?? {}))
    void window.flux
      .listStatuses()
      .then(fresh => {
        lastOptions = fresh
        setOptions(fresh)
      })
      .catch(error => setOptions({ groups: [], errors: [(error as Error).message] }))
  }, [])

  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    if (!next) return
    window.flux
      .saveSettings({ statusRules: next })
      .then(() => setSave(current => (pending.current ? current : 'saved')))
      .catch(error => {
        setSave('error')
        onError(`Statuts non enregistrés : ${(error as Error).message}`)
      })
  }

  // Closing never loses the last change
  useEffect(() => flush, [])

  // A row stands for its name in every project of the workspace that has it
  const keysOf = (status: TrackerStatus) =>
    status.projects.length > 0
      ? status.projects.map(project => statusKey(status.name, project))
      : [statusKey(status.name)]

  const choose = (status: TrackerStatus, role: StatusRole | '') => {
    const next = { ...(rules ?? {}) }
    delete next[statusKey(status.name)]
    // Picking Flux's own guess clears the rule, so a better guess later still applies
    const clear = role === '' || role === defaultRole(status.tracker, status.name, status.type)
    for (const key of keysOf(status)) {
      if (clear) delete next[key]
      else next[key] = role
    }
    setRules(next)
    setSave('pending')
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  const leave = (then: () => void) => {
    flush()
    then()
  }

  return (
    <>
      <header className="settings-subheader">
        <button
          type="button"
          className="round glass small"
          aria-label="Retour aux réglages"
          title="Réglages"
          onClick={() => leave(onBack)}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <h1>Statuts</h1>
        <span className={`save-state ${save}`} role="status">
          {save === 'pending' && <LoaderCircle size={13} className="spin" aria-hidden="true" />}
          {save === 'saved' && <Check size={13} aria-hidden="true" />}
          {save === 'pending' ? 'Enregistrement…' : save === 'saved' ? 'Enregistré' : ''}
        </span>
        <button type="button" className="round glass small" aria-label="Fermer" onClick={() => leave(onClose)}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <small className="settings-hint">
        Pour chaque colonne de ton board, ce qu’elle veut dire pour toi. « Auto » garde ce que Flux devine.
      </small>

      {options?.errors.map(error => (
        <small key={error} className="settings-error">
          {error}
        </small>
      ))}

      {!options || !rules ? (
        <small className="projects-loading">
          <LoaderCircle size={13} className="spin" aria-hidden="true" />
          Chargement…
        </small>
      ) : options.groups.length === 0 ? (
        <small className="settings-hint">Aucun statut trouvé dans tes espaces.</small>
      ) : (
        options.groups.map(group => (
          <section key={group.id} className="status-group" aria-label={group.label}>
            <h2>{group.label}</h2>
            <ul className="status-list">
              {ordered(group.statuses).map(status => {
                const guess = defaultRole(status.tracker, status.name, status.type)
                const chosen = keysOf(status).map(key => rules[key]).find(Boolean) ?? rules[statusKey(status.name)]
                return (
                  <li key={status.name} className={chosen ? 'custom' : undefined}>
                    <span className="status-name">{status.name}</span>
                    <select
                      aria-label={`Ce que veut dire ${status.name}`}
                      title={STATUS_ROLES.find(entry => entry.role === (chosen ?? guess))?.hint}
                      value={chosen ?? ''}
                      onChange={event => choose(status, event.target.value as StatusRole | '')}
                    >
                      <option value="">Auto · {STATUS_ROLE_LABEL[guess]}</option>
                      {STATUS_ROLES.map(entry => (
                        <option key={entry.role} value={entry.role}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </>
  )
}
