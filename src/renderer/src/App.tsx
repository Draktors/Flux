import { CalendarClock, Plug, Plus, Settings, Waves } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, Settings as FluxSettings, SourceName, TopicView } from '../../shared/types'
import { Boot, type BootProgress } from './Boot'
import { DailyView } from './DailyView'
import { until } from './format'
import { Hero, LooseHero } from './Hero'
import { Inspector } from './Inspector'
import { Onboarding } from './Onboarding'
import { looseId, Rail } from './Rail'
import { rankStyle, type RankStyle } from './rankStyle'
import { SettingsPanel } from './SettingsPanel'
import { Stage } from './Stage'
import { useSeen } from './useSeen'

type ListTab = 'queue' | 'active' | 'waiting' | 'notes' | 'dormant'
type Tab = ListTab | 'daily'

const DAILY_READ_KEY = 'flux.dailyRead'
// The loading scene plays at least this long, then dissolves into the app
const BOOT_MIN_MS = 1800
const BOOT_EXIT_MS = 900

const SOURCE_LABEL: Record<SourceName, string> = {
  github: 'GitHub',
  linear: 'Linear',
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
  const [tab, setTab] = useState<Tab>('queue')
  const [selected, setSelected] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [readDate, setReadDate] = useState(dailyRead)
  const [onboarding, setOnboarding] = useState(false)
  const [sceneTint, setSceneTint] = useState<RankStyle | null>(null)
  const [settings, setSettings] = useState<FluxSettings | null>(null)
  const [progress, setProgress] = useState<BootProgress>({})
  const [boot, setBoot] = useState<'playing' | 'leaving' | 'done'>('playing')
  const bootStart = useRef(performance.now())

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
  const listTab: ListTab = tab === 'daily' ? 'queue' : tab
  const list = state ? state[listTab] : []
  const current =
    (tab !== 'daily' && list.find(view => view.topic.id === selected)) ||
    (tab !== 'daily' ? views.find(view => view.topic.id === selected) : undefined) ||
    list[0]
  const looseItem =
    tab === 'waiting' ? state?.loose.find(item => looseId(item) === selected) : undefined
  const currentId = looseItem ? looseId(looseItem) : (current?.topic.id ?? null)
  const isFresh = useSeen(state?.queue ?? [], tab === 'daily' ? null : currentId)
  const focusRank = looseItem ? null : (current?.rank ?? null)
  const style = useMemo(() => rankStyle(focusRank), [focusRank])
  // Arrow keys walk the rail in order, loose items included
  const order = useMemo(
    () => [
      ...list.map(view => view.topic.id),
      ...(tab === 'waiting' ? (state?.loose ?? []).map(looseId) : []),
    ],
    [list, tab, state?.loose],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || tab === 'daily' || settingsOpen) return
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
  }, [order, currentId, tab, settingsOpen])

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
    { key: 'waiting', label: 'Attente', count: state.waiting.length + state.loose.length },
    { key: 'notes', label: 'Notes', count: state.notes.length },
    { key: 'dormant', label: 'Dormant', count: state.dormant.length },
    { key: 'daily', label: 'Daily', count: 0 },
  ]
  const failing = (Object.keys(state.sources) as SourceName[]).filter(
    name => !state.sources[name].ok,
  )
  const toConnect = failing.filter(name => !state.sources[name].at)
  const offline = failing.filter(name => state.sources[name].at)
  const meeting = state.meeting.current
    ? `En réunion : ${state.meeting.current.title}`
    : state.meeting.next
      ? `${state.meeting.next.title} ${until(state.meeting.next.start)}`
      : null
  const unreadDaily = state.daily.status === 'ready' && readDate !== state.daily.date
  const index = list.findIndex(view => view.topic.id === currentId)
  const position = tab === 'queue' && index >= 0 ? `${index + 1} sur ${list.length}` : null

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
          <DailyView daily={state.daily} />
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
                  <div className="hero-actions">
                    <button type="button" className="pill solid" onClick={() => void window.flux.openCapture()}>
                      Écrire une note
                      <Plus size={17} aria-hidden="true" />
                    </button>
                  </div>
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
          />
        )}

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
