import { Check, GitPullRequest, GripVertical, LoaderCircle, Plus, X } from 'lucide-react'
import { useEffect, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { ProjectOption, ProjectOptions, TrackedProject } from '../../shared/types'
import type { TrackerName } from '../../shared/trackers'
import { TrackerBadge, trackerInfo } from './Trackers'

// Listing projects takes a few seconds: keep the last answer while the panel comes and goes
let lastOptions: ProjectOptions | null = null

// The organisation every repo of a project lives in, shown once instead of on every row
function sharedOwner(repos: string[]): string | null {
  const owners = new Set(repos.map(repo => repo.split('/')[0]))
  return owners.size === 1 ? [...owners][0] : null
}

const same = (a: { tracker: TrackerName; key: string }, b: { tracker: TrackerName; key: string }) =>
  a.tracker === b.tracker && a.key === b.key

function RepoInput({
  repos,
  taken,
  onAdd,
}: {
  repos: string[]
  taken: string[]
  onAdd(repo: string): void
}) {
  const [value, setValue] = useState('')
  const free = repos.filter(repo => !taken.includes(repo))
  const listId = `repos-${taken.join('-').replace(/[^a-z0-9-]/gi, '') || 'none'}`
  const add = () => {
    const repo = value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '')
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || taken.includes(repo)) return
    onAdd(repo)
    setValue('')
  }
  return (
    <div className="repo-add">
      <input
        list={listId}
        placeholder="Ajouter un dépôt : organisation/nom"
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          add()
        }}
      />
      <datalist id={listId}>
        {free.map(repo => (
          <option key={repo} value={repo} />
        ))}
      </datalist>
      <button type="button" className="round glass small" aria-label="Ajouter le dépôt" onClick={add}>
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

export function ProjectsPicker({
  trackers,
  value,
  onChange,
}: {
  trackers: TrackerName[]
  value: TrackedProject[]
  onChange(next: TrackedProject[]): void
}) {
  const [options, setOptions] = useState<ProjectOptions | null>(lastOptions)
  const [loading, setLoading] = useState(false)
  // Key of the project being dragged, and of the one it would land on
  const [dragged, setDragged] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    if (trackers.length === 0) return
    setLoading(true)
    void window.flux
      .listProjects()
      .then(fresh => {
        lastOptions = fresh
        setOptions(fresh)
      })
      .catch(error =>
        setOptions({ projects: [], repos: [], errors: [(error as Error).message] }),
      )
      .finally(() => setLoading(false))
  }, [trackers.join(',')])

  if (trackers.length === 0) {
    return <small>Connecte Jira ou Linear pour choisir tes projets.</small>
  }

  const listed = (options?.projects ?? []).filter(option => trackers.includes(option.tracker))
  // Followed projects come first, in the order of the switch; a followed project stays visible
  // even when its tool could not be listed
  const others = listed.filter(option => !value.some(project => same(project, option)))
  const rows: ProjectOption[] = [...value, ...others]
  const chosen = (option: ProjectOption) => value.find(project => same(project, option))
  const idOf = (option: ProjectOption) => `${option.tracker}:${option.key}`

  // Moves a followed project to where another one sits, which sets the order of the switch
  const move = (from: string, to: string) => {
    const start = value.findIndex(project => idOf(project) === from)
    const end = value.findIndex(project => idOf(project) === to)
    if (start < 0 || end < 0 || start === end) return
    const next = [...value]
    const [moved] = next.splice(start, 1)
    next.splice(end, 0, moved)
    onChange(next)
  }

  const step = (option: ProjectOption, offset: number) => {
    const index = value.findIndex(project => same(project, option))
    const other = value[index + offset]
    if (other) move(idOf(option), idOf(other))
  }

  const endDrag = () => {
    setDragged(null)
    setTarget(null)
  }

  const toggle = (option: ProjectOption) =>
    onChange(
      chosen(option)
        ? value.filter(project => !same(project, option))
        : [...value, { ...option, repos: [], noReview: [] }],
    )

  const update = (project: TrackedProject, patch: Partial<TrackedProject>) =>
    onChange(value.map(entry => (same(entry, project) ? { ...entry, ...patch } : entry)))

  return (
    <div className="projects">
      {loading && !options && (
        <small className="projects-loading">
          <LoaderCircle size={13} className="spin" aria-hidden="true" />
          Lecture de tes projets…
        </small>
      )}
      {options?.errors.map(error => (
        <small key={error} className="settings-error">
          {error}
        </small>
      ))}
      {options && rows.length === 0 && <small>Aucun projet trouvé avec ces accès.</small>}

      <ul className="project-list">
        {rows.map((option, index) => {
          const project = chosen(option)
          const id = idOf(option)
          const classes = [
            project ? 'chosen' : '',
            dragged === id ? 'dragging' : '',
            target === id && dragged !== id ? 'drop-target' : '',
          ].filter(Boolean)
          return (
            <li
              key={id}
              className={classes.join(' ') || undefined}
              data-first-other={!project && index === value.length && value.length > 0 ? '' : undefined}
              onDragOver={(event: DragEvent) => {
                if (!dragged || !project) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                if (target !== id) setTarget(id)
              }}
              onDrop={(event: DragEvent) => {
                event.preventDefault()
                if (dragged && project) move(dragged, id)
                endDrag()
              }}
            >
              <div className="project-head">
              {project && value.length > 1 && (
                <span
                  className="project-grip"
                  draggable
                  role="button"
                  tabIndex={0}
                  aria-label={`Déplacer ${option.key} (flèches haut et bas)`}
                  title="Glisser pour changer l’ordre du sélecteur"
                  onDragStart={(event: DragEvent) => {
                    setDragged(id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', id)
                    const row = (event.currentTarget as HTMLElement).closest('li')
                    if (row) event.dataTransfer.setDragImage(row, 24, 20)
                  }}
                  onDragEnd={endDrag}
                  onKeyDown={(event: KeyboardEvent) => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault()
                      step(option, event.key === 'ArrowUp' ? -1 : 1)
                    }
                  }}
                >
                  <GripVertical size={14} aria-hidden="true" />
                </span>
              )}
              <button
                type="button"
                className="project-row"
                role="checkbox"
                aria-checked={Boolean(project)}
                onClick={() => toggle(option)}
              >
                <span className="project-check" aria-hidden="true">
                  {project && <Check size={12} strokeWidth={3} />}
                </span>
                <TrackerBadge name={option.tracker} size={20} />
                <strong>{option.key}</strong>
                <span className="project-name">{option.name}</span>
                <small>{trackerInfo(option.tracker).label}</small>
              </button>
              </div>

              {project && (
                <div className="project-repos">
                  <span className="project-repos-title">
                    <GitPullRequest size={13} aria-hidden="true" />
                    Dépôts GitHub de {project.key}
                    {sharedOwner(project.repos) && (
                      <span className="repo-owner-shared">· {sharedOwner(project.repos)}</span>
                    )}
                  </span>
                  {project.repos.length === 0 && (
                    <small>Sans dépôt, les PR de ce projet ne sont pas rattachées.</small>
                  )}
                  {project.repos.map(repo => {
                    const quick = project.noReview.includes(repo)
                    return (
                      <div className="repo-chip" key={repo}>
                        <span className="repo-name" title={repo}>
                          {!sharedOwner(project.repos) && (
                            <span className="repo-owner">{repo.split('/')[0]}/</span>
                          )}
                          <span className="repo-short">{repo.split('/').slice(1).join('/')}</span>
                        </span>
                        <button
                          type="button"
                          className={`repo-flag${quick ? ' on' : ''}`}
                          aria-pressed={quick}
                          title="Tes PR s'y intègrent sans relecture"
                          onClick={() =>
                            update(project, {
                              noReview: quick
                                ? project.noReview.filter(entry => entry !== repo)
                                : [...project.noReview, repo],
                            })
                          }
                        >
                          Sans review
                        </button>
                        <button
                          type="button"
                          className="ghost visible"
                          aria-label={`Retirer ${repo}`}
                          onClick={() =>
                            update(project, {
                              repos: project.repos.filter(entry => entry !== repo),
                              noReview: project.noReview.filter(entry => entry !== repo),
                            })
                          }
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </div>
                    )
                  })}
                  <RepoInput
                    repos={options?.repos ?? []}
                    taken={project.repos}
                    onAdd={repo => update(project, { repos: [...project.repos, repo] })}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
