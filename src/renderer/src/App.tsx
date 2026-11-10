import { CalendarClock, CloudOff, Plug, Plus, RefreshCw, Settings, Waves } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AppState, SourceName, TopicView } from '../../shared/types'
import type { CallsState } from '../../shared/calls'
import { CallsView } from './CallsView'
import { DailyView } from './DailyView'
import { until } from './format'
import { Hero } from './Hero'
import { Inspector } from './Inspector'
import { Onboarding } from './Onboarding'
import { Rail } from './Rail'
import { rankStyle, type RankStyle } from './rankStyle'
import { SettingsPanel } from './SettingsPanel'
import { Toast, type ToastMessage } from './Toast'
import { Stage } from './Stage'
import { useSeen } from './useSeen'

type ListTab = 'queue' | 'active' | 'waiting' | 'notes' | 'dormant'
type Tab = ListTab | 'daily' | 'calls'

const DAILY_READ_KEY = 'flux.dailyRead'

const SOURCE_LABEL: Record<SourceName, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  agents: 'Agents',
  calendar: 'Agenda',
}

function allViews(state: AppState): TopicView[] {
  return [...state.queue, ...state.active, ...state.waiting, ...state.notes, ...state.dormant]
}

function tabFor(state: AppState, id: string): ListTab | null {
  const has = (views: TopicView[]) => views.some(view => view.topic.id === id)
  if (has(state.queue)) return 'queue'
  if (has(state.active)) return 'active'
  if (has(state.waiting)) return 'waiting'
  if (has(state.notes)) return 'notes'
  if (has(state.dormant)) return 'dormant'
  return null
}

function emptyTitle(tab: ListTab, looseCount: number): string {
  if (tab === 'queue') return "Rien ne t'attend."
  if (tab === 'waiting' && looseCount > 0) return 'Ces sujets attendent les autres.'
  return 'Rien ici pour le moment.'
}

function dailyRead(): string | null {
  try {
    return localStorage.getItem(DAILY_READ_KEY)
  } catch {
    return null
  }
}

function markDailyRead(date: string): void {
  try {
    localStorage.setItem(DAILY_READ_KEY, date)
  } catch {
    return
  }
}

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [callsState, setCallsState] = useState<CallsState | null>(null)
  const [tab, setTab] = useState<Tab>('queue')
  const [selected, setSelected] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const showToast = (text: string, tone: ToastMessage['tone'] = 'ok') =>
    setToast({ id: Date.now(), text, tone })
  const [readDate, setReadDate] = useState(dailyRead)
  const [onboarding, setOnboarding] = useState(false)
  const [sceneTint, setSceneTint] = useState<RankStyle | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = () => {
    if (refreshing) return
    setRefreshing(true)
    // Spins at least one turn, so a fast refresh still reads as done
    const minimum = new Promise(resolve => setTimeout(resolve, 700))
    Promise.all([window.flux.refresh(), minimum])
      .catch(error => showToast(`Rafraîchissement impossible : ${(error as Error).message}`, 'error'))
      .finally(() => setRefreshing(false))
  }

  useEffect(() => window.flux.onRefreshShortcut(refresh))

  // Chosen workspace until the main process confirms it with a new state
  const [switching, setSwitching] = useState<string | null>(null)

  const switchWorkspace = (id: string) => {
    if (id === (switching ?? state?.workspace)) return
    setSwitching(id)
    setSelected(null)
    window.flux.saveSettings({ workspace: id }).catch(error => {
      setSwitching(null)
      showToast(`Changement d’espace impossible : ${(error as Error).message}`, 'error')
    })
  }

  useEffect(() => {
    if (switching && state?.workspace === switching) setSwitching(null)
  }, [state?.workspace])

  useEffect(() => {
    void window.flux.getSettings().then(settings => setOnboarding(!settings.onboarded))
  }, [])

  useEffect(() => {
    void window.flux.getState().then(setState)
    return window.flux.onState(setState)
  }, [])

  useEffect(() => {
    void window.flux.getCalls().then(setCallsState)
    return window.flux.onCalls(setCallsState)
  }, [])

  useEffect(
    () =>
      window.flux.onOpenTopic(id => {
        setSelected(id)
        setSettingsOpen(false)
      }),
    [],
  )

  useEffect(() => window.flux.onOpenDaily(() => setTab('daily')), [])

  useEffect(() => {
    if (!state || !selected) return
    const owner = tabFor(state, selected)
    if (owner && owner !== tab) setTab(owner)
  }, [selected])

  useEffect(() => {
    if (tab === 'daily' && state?.daily.status === 'ready') {
      markDailyRead(state.daily.date)
      setReadDate(state.daily.date)
    }
  }, [tab, state?.daily.status, state?.daily.date])

  const views = useMemo(() => (state ? allViews(state) : []), [state])
  const listTab: ListTab = tab === 'daily' || tab === 'calls' ? 'queue' : tab
  const list = state ? state[listTab] : []
  const current =
    (tab !== 'daily' && list.find(view => view.topic.id === selected)) ||
    (tab !== 'daily' ? views.find(view => view.topic.id === selected) : undefined) ||
    list[0]
  const currentId = current?.topic.id ?? null
  const isFresh = useSeen(state?.queue ?? [], tab === 'daily' ? null : currentId)
  const style = useMemo(() => rankStyle(current?.rank ?? null), [current?.rank])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || tab === 'daily' || tab === 'calls' || settingsOpen) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const index = list.findIndex(view => view.topic.id === currentId)
      const next = list[index + (event.key === 'ArrowRight' ? 1 : -1)]
      if (next) {
        event.preventDefault()
        setSelected(next.topic.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list, currentId, tab, settingsOpen])

  if (onboarding) {
    return (
      <div className="app">
        <Stage style={sceneTint ?? style} drift />
        <div className="veil" aria-hidden="true" />
        <Onboarding
          onTint={setSceneTint}
          onDone={() => {
            setOnboarding(false)
            setSceneTint(null)
            void window.flux.refresh()
          }}
        />
      </div>
    )
  }

  if (!state) return <div className="boot" />

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'queue', label: 'File', count: state.queue.length },
    { key: 'active', label: 'En cours', count: state.active.length },
    { key: 'waiting', label: 'Attente', count: state.waiting.length + state.loose.length },
    { key: 'notes', label: 'Notes', count: state.notes.length },
    { key: 'dormant', label: 'Dormant', count: state.dormant.length },
    { key: 'calls', label: 'Calls', count: callsState?.calls.filter(call => call.uncertain).length ?? 0 },
    { key: 'daily', label: 'Daily', count: 0 },
  ]
  const failing = (Object.keys(state.sources) as SourceName[]).filter(
    name => !state.sources[name]?.ok,
  )
  // Before its first answer a source is just loading: only an unconfigured one asks to connect
  const toConnect = failing.filter(name => state.sources[name]?.missing)
  const offline = failing.filter(name => state.sources[name]?.error && !state.sources[name]?.missing)
  // The title gives way to the time when the bar runs short
  const meeting = state.meeting.current
    ? { title: state.meeting.current.title, when: 'en cours' }
    : state.meeting.next
      ? { title: state.meeting.next.title, when: until(state.meeting.next.start) }
      : null
  const offlineLabel = offline.map(name => SOURCE_LABEL[name]).join(', ')
  const connectLabel = toConnect.map(name => SOURCE_LABEL[name]).join(', ')
  const unreadDaily = state.daily.status === 'ready' && readDate !== state.daily.date
  const index = list.findIndex(view => view.topic.id === currentId)
  const position = tab === 'queue' && index >= 0 ? `${index + 1} sur ${list.length}` : null

  return (
    <div className="app">
      <Stage style={style} />
      <div className="veil" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark glass">
            <Waves size={16} strokeWidth={2.4} aria-hidden="true" />
          </span>
          Flux
          {state.workspaces.length > 1 && (
            <nav className="tabs glass lens workspace-switch" aria-label="Espace de travail">
              {state.workspaces.map(workspace => (
                <button
                  type="button"
                  key={workspace.id}
                  title={workspace.label}
                  aria-current={(switching ?? state.workspace) === workspace.id ? 'page' : undefined}
                  onClick={() => switchWorkspace(workspace.id)}
                >
                  {workspace.short}
                </button>
              ))}
            </nav>
          )}
        </div>

        <nav className="tabs glass lens" aria-label="Vues">
          {tabs.map(entry => (
            <button
              type="button"
              key={entry.key}
              aria-current={tab === entry.key ? 'page' : undefined}
              onClick={() => {
                setTab(entry.key)
                setSelected(null)
                setSettingsOpen(false)
              }}
            >
              {entry.label}
              {entry.count > 0 && <span className="count">{entry.count}</span>}
              {entry.key === 'daily' && unreadDaily && (
                <span className="unread" aria-label="Nouveau daily" />
              )}
            </button>
          ))}
        </nav>

        <div className="topbar-end">
          {meeting && (
            <span className="chip glass meeting" title={`${meeting.title} ${meeting.when}`}>
              <CalendarClock size={14} aria-hidden="true" />
              <span className="chip-text">{meeting.title}</span>
              <span className="chip-when">{meeting.when}</span>
            </span>
          )}
          {offline.length > 0 && (
            <span className="chip glass warn compact" title={`Hors ligne : ${offlineLabel}`}>
              <CloudOff size={14} aria-hidden="true" />
              <span className="chip-text">Hors ligne</span>
            </span>
          )}
          {toConnect.length > 0 && (
            <button
              type="button"
              className="chip glass compact"
              title={`Connecter ${connectLabel}`}
              onClick={() => setSettingsOpen(true)}
            >
              <Plug size={14} aria-hidden="true" />
              <span className="chip-text">Connecter</span>
            </button>
          )}
          <button type="button" className="pill glass" onClick={() => void window.flux.openCapture()}>
            Note
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="round glass"
            aria-label="Rafraîchir"
            title="Rafraîchir (⌘R)"
            disabled={refreshing}
            onClick={refresh}
          >
            <RefreshCw size={16} aria-hidden="true" className={refreshing ? 'spin' : undefined} />
          </button>
          <button
            type="button"
            className="round glass"
            aria-label="Réglages"
            title="Réglages"
            onClick={() => setSettingsOpen(open => !open)}
          >
            <Settings size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      {tab === 'calls' ? (
        callsState && (
          <CallsView state={callsState} workspace={switching ?? state.workspace} workspaces={state.workspaces} />
        )
      ) : tab === 'daily' ? (
        <DailyView daily={state.daily} />
      ) : (
        <>
          <main className="focus">
            {current ? (
              <>
                <Hero key={current.topic.id} view={current} position={position} />
                <Inspector key={`note-${current.topic.id}`} view={current} />
              </>
            ) : (
              <section className="hero">
                <h1 className="hero-empty">{emptyTitle(listTab, state.loose.length)}</h1>
                {(listTab === 'queue' || listTab === 'notes') && (
                  <div className="hero-actions">
                    <button type="button" className="pill solid" onClick={() => void window.flux.openCapture()}>
                      Écrire une note
                      <Plus size={17} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </section>
            )}
          </main>
          <Rail
            views={list}
            loose={tab === 'waiting' ? state.loose : undefined}
            grouped={tab === 'queue'}
            selected={currentId}
            isFresh={isFresh}
            onSelect={setSelected}
          />
        </>
      )}

      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onReplay={() => {
            setSettingsOpen(false)
            setOnboarding(true)
          }}
          onSaved={() => {
            setSettingsOpen(false)
            showToast('Réglages enregistrés')
          }}
          onError={message => showToast(message, 'error')}
        />
      )}

      {toast && <Toast key={toast.id} toast={toast} onDone={() => setToast(null)} />}

      <svg className="filters" aria-hidden="true">
        <filter id="lens" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
          <feDisplacementMap in="SourceGraphic" in2="soft" scale="26" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
    </div>
  )
}
