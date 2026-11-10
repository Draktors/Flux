import { CalendarClock, Plug, Plus, RefreshCw, Settings, Waves } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, Settings as FluxSettings, SourceName, TopicView } from '../../shared/types'
import { Boot, type BootProgress } from './Boot'
import { Changelog } from './Changelog'
import { DailyView } from './DailyView'
import { clock, until } from './format'
import { Hero, LooseHero } from './Hero'
import { Inspector } from './Inspector'
import { Onboarding } from './Onboarding'
import { looseId, ownerGroups, Rail } from './Rail'
import { rankStyle, type RankStyle } from './rankStyle'
import { SettingsPanel } from './SettingsPanel'
import { Toast, type ToastMessage } from './Toast'
import { Stage } from './Stage'
import { useSeen } from './useSeen'
import { WrapupView } from './WrapupView'

type ListTab = 'queue' | 'active' | 'waiting' | 'notes'
type SheetTab = 'wrapup' | 'daily'
type Tab = ListTab | SheetTab

const DAILY_READ_KEY = 'flux.dailyRead'
const WRAPUP_READ_KEY = 'flux.wrapupRead'
// The loading scene plays at least this long, then dissolves into the app
const BOOT_MIN_MS = 1800
const BOOT_EXIT_MS = 900

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

function isSheet(tab: Tab): tab is SheetTab {
  return tab === 'wrapup' || tab === 'daily'
}

// Waiting puts my own work before the work of others; dormant topics close each half
function listOf(state: AppState, tab: ListTab): TopicView[] {
  if (tab !== 'waiting') return state[tab]
  return ownerGroups([...state.waiting, ...state.dormant], []).flatMap(group => group.views)
}

function tabFor(state: AppState, id: string): ListTab | null {
  const has = (views: TopicView[]) => views.some(view => view.topic.id === id)
  if (has(state.queue)) return 'queue'
  if (has(state.active)) return 'active'
  if (has(listOf(state, 'waiting'))) return 'waiting'
  if (has(state.notes)) return 'notes'
  return null
}

function emptyTitle(tab: ListTab, looseCount: number): string {
  if (tab === 'queue') return "Rien ne t'attend."
  if (tab === 'waiting' && looseCount > 0) return 'Ces sujets attendent les autres.'
  return 'Rien ici pour le moment.'
}

function readMark(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function saveMark(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [tab, setTab] = useState<Tab>('queue')
  const [selected, setSelected] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const showToast = (text: string, tone: ToastMessage['tone'] = 'ok') =>
    setToast({ id: Date.now(), text, tone })
  const [readDate, setReadDate] = useState(() => readMark(DAILY_READ_KEY))
  const [readSlot, setReadSlot] = useState(() => readMark(WRAPUP_READ_KEY))
  const [onboarding, setOnboarding] = useState(false)
  const [sceneTint, setSceneTint] = useState<RankStyle | null>(null)
  const [settings, setSettings] = useState<FluxSettings | null>(null)
  const [progress, setProgress] = useState<BootProgress>({})
  const [boot, setBoot] = useState<'playing' | 'leaving' | 'done'>('playing')
  const [refreshing, setRefreshing] = useState(false)
  const bootStart = useRef(performance.now())

  // Refetches every source, calendar included; the button and ⌘R share it
  const refreshAll = () => {
    if (refreshing) return
    setRefreshing(true)
    window.flux
      .refreshAll()
      .catch(error => showToast(`Actualisation impossible : ${(error as Error).message}`, 'error'))
      .finally(() => setRefreshing(false))
  }

  useEffect(() => window.flux.onRefreshShortcut(refreshAll))

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
    void window.flux.getSettings().then(loaded => {
      setSettings(loaded)
      setOnboarding(!loaded.onboarded)
    })
  }, [])

  useEffect(() => {
    void window.flux.getState().then(initial => {
      // A window opened after the first sync has nothing to wait for
      if (initial) setBoot('done')
      setState(current => current ?? initial)
    })
    const stopState = window.flux.onState(setState)
    const stopProgress = window.flux.onProgress(({ source, ok }) =>
      setProgress(current => ({ ...current, [source]: ok })),
    )
    return () => {
      stopState()
      stopProgress()
    }
  }, [])

  useEffect(() => {
    if (!state || boot !== 'playing') return undefined
    const wait = Math.max(0, BOOT_MIN_MS - (performance.now() - bootStart.current))
    const timer = setTimeout(() => setBoot('leaving'), wait)
    return () => clearTimeout(timer)
  }, [state, boot])

  useEffect(() => {
    if (boot !== 'leaving') return undefined
    const timer = setTimeout(() => setBoot('done'), BOOT_EXIT_MS)
    return () => clearTimeout(timer)
  }, [boot])

  useEffect(
    () =>
      window.flux.onOpenTopic(id => {
        setSelected(id)
        setSettingsOpen(false)
      }),
    [],
  )

  useEffect(() => window.flux.onOpenDaily(() => setTab('daily')), [])
  useEffect(
    () =>
      window.flux.onOpenWrapup(() => {
        setTab('wrapup')
        setSettingsOpen(false)
      }),
    [],
  )

  useEffect(() => {
    if (!state || !selected) return
    const owner = tabFor(state, selected)
    if (owner && owner !== tab) setTab(owner)
  }, [selected])

  useEffect(() => {
    if (tab === 'daily' && state?.daily.status === 'ready') {
      saveMark(DAILY_READ_KEY, state.daily.date)
      setReadDate(state.daily.date)
    }
  }, [tab, state?.daily.status, state?.daily.date])

  const wrapupMark = state?.wrapup.slot ? `${state.wrapup.date} ${state.wrapup.slot}` : null
  useEffect(() => {
    if (tab === 'wrapup' && wrapupMark) {
      saveMark(WRAPUP_READ_KEY, wrapupMark)
      setReadSlot(wrapupMark)
    }
  }, [tab, wrapupMark])

  const views = useMemo(() => (state ? allViews(state) : []), [state])
  const sheet = isSheet(tab)
  const listTab: ListTab = isSheet(tab) ? 'queue' : tab
  const list = useMemo(() => (state ? listOf(state, listTab) : []), [state, listTab])
  const current =
    (!sheet && list.find(view => view.topic.id === selected)) ||
    (!sheet ? views.find(view => view.topic.id === selected) : undefined) ||
    list[0]
  const looseItem =
    tab === 'waiting' ? state?.loose.find(item => looseId(item) === selected) : undefined
  const currentId = looseItem ? looseId(looseItem) : (current?.topic.id ?? null)
  const isFresh = useSeen(state?.queue ?? [], sheet ? null : currentId)
  const focusRank = looseItem ? null : (current?.rank ?? null)
  const style = useMemo(() => rankStyle(focusRank), [focusRank])
  // Arrow keys walk the rail in order, loose items included
  const order = useMemo(
    () =>
      tab === 'waiting'
        ? ownerGroups(list, state?.loose ?? []).flatMap(group => [
            ...group.views.map(view => view.topic.id),
            ...group.loose.map(looseId),
          ])
        : list.map(view => view.topic.id),
    [list, tab, state?.loose],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || sheet || settingsOpen) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const index = order.indexOf(currentId ?? '')
      const next = order[index + (event.key === 'ArrowRight' ? 1 : -1)]
      if (next) {
        event.preventDefault()
        setSelected(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order, currentId, sheet, settingsOpen])

  // Same slot in both trees, so the scene keeps playing while the app appears underneath
  const bootScene =
    boot === 'done' ? null : (
      <Boot leaving={boot === 'leaving'} progress={progress} settings={settings} />
    )

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

  if (!state || settings === null) {
    return (
      <>
        {null}
        {bootScene}
      </>
    )
  }

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'queue', label: 'File', count: state.queue.length },
    { key: 'active', label: 'En cours', count: state.active.length },
    {
      key: 'waiting',
      label: 'Attente',
      count: state.waiting.length + state.dormant.length + state.loose.length,
    },
    { key: 'notes', label: 'Notes', count: state.notes.length },
    { key: 'wrapup', label: 'Wrap-up', count: 0 },
    { key: 'daily', label: 'Daily', count: 0 },
  ]
  const failing = (Object.keys(state.sources) as SourceName[]).filter(
    name => !state.sources[name]?.ok,
  )
  // Before its first answer a source is just loading: only an unconfigured one asks to connect
  const toConnect = failing.filter(name => state.sources[name]?.missing)
  const offline = failing.filter(name => state.sources[name]?.error && !state.sources[name]?.missing)
  const meeting = state.meeting.current
    ? `En réunion : ${state.meeting.current.title}`
    : state.meeting.next
      ? `${state.meeting.next.title} ${until(state.meeting.next.start)}`
      : null
  const unreadDaily = state.daily.status === 'ready' && readDate !== state.daily.date
  const unreadWrapup = wrapupMark !== null && readSlot !== wrapupMark
  const index = list.findIndex(view => view.topic.id === currentId)
  const position = tab === 'queue' && index >= 0 ? `${index + 1} sur ${list.length}` : null
  const openTopic = (id: string) => {
    setSelected(id)
    setTab(tabFor(state, id) ?? 'queue')
  }
  // A dated line at the end of the topic's note
  const addNote = (id: string, text: string) => {
    const topic = views.find(view => view.topic.id === id)?.topic
    if (!topic) return
    const stamp = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    const head = topic.body.trim() ? `${topic.body.trimEnd()}\n\n` : ''
    void window.flux.updateTopic(id, { body: `${head}**${stamp}** — ${text}\n` })
  }

  return (
    <>
      <div className={`app${boot === 'playing' ? ' booting' : ''}`}>
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
                {entry.key === 'wrapup' && unreadWrapup && (
                  <span className="unread" aria-label="Wrap-up à faire" />
                )}
              </button>
            ))}
          </nav>

          <div className="topbar-end">
            {meeting && (
              <span className="chip glass">
                <CalendarClock size={14} aria-hidden="true" />
                {meeting}
              </span>
            )}
            {offline.length > 0 && (
              <span className="chip glass warn">
                Hors ligne : {offline.map(name => SOURCE_LABEL[name]).join(', ')}
              </span>
            )}
            {toConnect.length > 0 && (
              <button type="button" className="chip glass" onClick={() => setSettingsOpen(true)}>
                <Plug size={14} aria-hidden="true" />
                Connecter {toConnect.map(name => SOURCE_LABEL[name]).join(', ')}
              </button>
            )}
            <button
            type="button"
            className="round glass refresh"
            aria-label="Tout actualiser"
            aria-busy={refreshing}
            disabled={refreshing}
            title={
              refreshing
                ? 'Actualisation…'
                : `Tout actualiser (⌘R) · synchro de ${clock(state.generatedAt)}`
            }
            onClick={refreshAll}
          >
            <RefreshCw size={17} className={refreshing ? 'spin' : undefined} aria-hidden="true" />
          </button>
          <Changelog />
          <button type="button" className="pill glass" onClick={() => void window.flux.openCapture()}>
              Note
              <Plus size={16} aria-hidden="true" />
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

        {tab === 'daily' ? (
          <DailyView daily={state.daily} onOpen={openTopic} onNote={addNote} />
        ) : tab === 'wrapup' ? (
          <WrapupView wrapup={state.wrapup} onOpen={openTopic} />
        ) : (
          <>
            <main className="focus">
              {looseItem ? (
                <LooseHero key={currentId} item={looseItem} />
              ) : current ? (
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
              grouping={tab === 'queue' ? 'rank' : tab === 'waiting' ? 'owner' : 'none'}
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
      {bootScene}
    </>
  )
}
