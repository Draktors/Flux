import { ChevronsLeftRight, Pause, Play, Plus, RefreshCw, Settings as Gear, Sparkles, Waves, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Rank } from '../../shared/types'
import { BrandIcon } from './Brand'
import { rankStyle, tint } from './rankStyle'
import { Stage } from './Stage'

// The presentation of what is new. Each feature plays on a miniature of the Flux window,
// 960 by 600: what changed, where it lives, and a dive into it. A before/after scene stacks two
// windows and a split wipes from one to the other.
// Every timing below is in seconds from the start of its scene.

const W = 960
const H = 600
const LEAVE_MS = 500
const EASE = 'cubic-bezier(0.65, 0, 0.25, 1)'

// Camera: at time t, scale s, the window point x, y at the centre of the frame
type Cam = [t: number, s: number, x: number, y: number]
type View = [s: number, x: number, y: number]
// Cursor: at time t, at x, y in the window, shown or not
type Pt = [t: number, x: number, y: number, shown?: number]
type Click = [t: number, x: number, y: number]
// Spotlight: between two times, everything but this rectangle of the window dims
type Focus = [from: number, to: number, x: number, y: number, w: number, h: number, r: number]
// Split: at time t, the line between before (left) and after (right) sits at x, shown or not
type Split = [t: number, x: number, shown?: number]

// The window under the headline, then the window alone with room left for the captions
const GLOBAL: View = [0.62, 480, 215]
const WHOLE: View = [0.82, 480, 322]

function cam(t: number, view: View): Cam {
  return [t, ...view]
}

function camTransform([, s, x, y]: Cam): string {
  return `translate(${W / 2 - x * s}px, ${H / 2 - y * s}px) scale(${s})`
}

// A keyframes rule from timed steps, held between steps and eased through each move
function keyframes(name: string, total: number, steps: Array<[number, string]>): string {
  const all: Array<[number, string]> = [[0, steps[0][1]], ...steps, [total, steps[steps.length - 1][1]]]
  const frames = all.map(
    ([t, css]) => `${Math.min(100, (t / total) * 100).toFixed(3)}% { ${css} animation-timing-function: ${EASE}; }`,
  )
  return `@keyframes ${name} { ${frames.join(' ')} }`
}

function d(delay: number, extra: CSSProperties = {}): CSSProperties {
  return { '--d': `${delay}s`, ...extra } as CSSProperties
}

function span(from: number, to: number, extra: CSSProperties = {}): CSSProperties {
  return { '--d': `${from}s`, '--len': `${Math.max(0.1, to - from)}s`, ...extra } as CSSProperties
}

function pos(left: number, top: number, extra: CSSProperties = {}): CSSProperties {
  return { left, top, ...extra }
}

/* The window */

interface TabSpec {
  label: string
  width: number
  count?: number | [before: number, after: number, at: number]
  // Active between two times
  on?: [number, number]
  // The label it replaces, and when
  swap?: [string, number]
  dot?: [number, number]
}

const TAB_ORDER = ['File', 'En cours', 'Attente', 'Notes', 'Wrap-up', 'Daily']
const TAB_WIDTH: Record<string, number> = { File: 70, 'En cours': 92, Attente: 88, Notes: 70, 'Wrap-up': 92, Daily: 70 }
const TAB_COUNT: Record<string, number> = { File: 4, 'En cours': 2, Attente: 2 }

function tabs(overrides: Record<string, Partial<TabSpec>>): TabSpec[] {
  return TAB_ORDER.map(label => ({
    label,
    width: TAB_WIDTH[label],
    count: TAB_COUNT[label],
    ...overrides[label],
  }))
}

function Count({ count }: { count: TabSpec['count'] }) {
  if (count === undefined) return null
  if (typeof count === 'number') return <span className="w-count">{count}</span>
  const [before, after, at] = count
  return (
    <span className="w-count swap">
      <span className="w-out" style={d(at)}>
        {before}
      </span>
      <span className="w-bump" style={d(at)}>
        {after}
      </span>
    </span>
  )
}

function TabLabel({ tab }: { tab: TabSpec }) {
  return (
    <span className="w-tab-label">
      {tab.label}
      <Count count={tab.count} />
    </span>
  )
}

function Tabs({ specs }: { specs: TabSpec[] }) {
  return (
    <div className="w-tabs">
      {specs.map(tab => (
        <span key={tab.label} className="w-tab" style={{ width: tab.width }}>
          {tab.swap ? (
            <span className="w-swap">
              <span className="w-swap-out" style={d(tab.swap[1])}>
                {tab.swap[0]}
                <span className="w-count">1</span>
              </span>
              <span className="w-swap-in" style={d(tab.swap[1] + 0.25)}>
                {tab.label}
              </span>
              <span className="w-ring" style={d(tab.swap[1] + 0.25)} />
            </span>
          ) : (
            <TabLabel tab={tab} />
          )}
          {/* The selected look covers the tab with its own dark label */}
          {tab.on && (
            <span className="w-tab-on w-span" style={span(...tab.on)}>
              <TabLabel tab={tab} />
            </span>
          )}
          {tab.dot && <span className="w-dot w-span" style={span(...tab.dot)} />}
        </span>
      ))}
    </div>
  )
}

function Chrome({
  specs,
  className = '',
  style,
  children,
}: {
  specs: TabSpec[]
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div className={`w-window ${className}`} style={style}>
      <div className="w-backdrop" />
      {children}
      <div className="w-topbar">
        <span className="w-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="w-brand">
          <span className="w-brand-mark">
            <Waves size={12} strokeWidth={2.4} />
          </span>
          Flux
        </span>
        <Tabs specs={specs} />
        <span className="w-round" style={pos(742, 14)}>
          <RefreshCw size={13} />
        </span>
        <span className="w-round" style={pos(786, 14)}>
          <Sparkles size={13} />
        </span>
        <span className="w-note" style={pos(830, 14)}>
          Note
          <Plus size={12} />
        </span>
        <span className="w-round" style={pos(908, 14)}>
          <Gear size={13} />
        </span>
      </div>
    </div>
  )
}

interface Card {
  ref: string
  title: string
  meta: string
  rank: Rank
}

const QUEUE: Card[] = [
  { ref: 'daca#1516', title: 'Sortie de RxJS, lot 1', meta: '14 retours de Paul', rank: 1 },
  { ref: 'hb#6966', title: 'Vue recueil et documents', meta: 'Review demandée', rank: 2 },
  { ref: 'OFF-1040', title: 'Bandeau hors ligne', meta: 'Question de Margaux', rank: 3 },
  { ref: 'daca#1601', title: 'Rejouer la file après un 401', meta: 'Prête à livrer', rank: 4 },
]

function CardView({
  card,
  selected,
  style,
  className = '',
  children,
}: {
  card: Card
  selected?: boolean
  style?: CSSProperties
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={`w-card${selected ? ' selected' : ''} ${className}`}
      style={{ ...tint(rankStyle(card.rank)), ...style }}
    >
      <span className="w-card-ref">{card.ref}</span>
      <span className="w-card-title">{card.title}</span>
      {card.meta && <span className="w-card-meta">{card.meta}</span>}
      {children}
    </div>
  )
}

function Rail({ cards, selected = 0 }: { cards: Card[]; selected?: number }) {
  return (
    <>
      {cards.map((card, index) => (
        <CardView key={card.ref} card={card} selected={index === selected} style={pos(640, 84 + index * 72)} />
      ))}
    </>
  )
}

interface HeroProps {
  chip: string
  rank: Rank
  title: string
  meta: string
  primary: string
  secondary: string
}

function Hero({ chip, rank, title, meta, primary, secondary }: HeroProps) {
  return (
    <>
      <span className="w-chip" style={pos(48, 140, { color: rankStyle(rank).light })}>
        {chip}
      </span>
      <h3 className="w-hero-title" style={pos(48, 178)}>
        {title}
      </h3>
      <span className="w-hero-meta" style={pos(48, 270)}>
        {meta}
      </span>
      <span className="w-button solid" style={pos(48, 314, { width: 150 })}>
        {primary}
      </span>
      <span className="w-button" style={pos(208, 314, { width: 112 })}>
        {secondary}
      </span>
    </>
  )
}

function QueuePage({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={`w-layer ${className}`} style={style}>
      <Hero
        chip="Retours sur mes PR"
        rank={1}
        title="Traiter les 14 retours de Paul sur l’outbox"
        meta="daca#1516 · en attente depuis 13 j"
        primary="Ouvrir dans Claude"
        secondary="Voir la PR"
      />
      <Rail cards={QUEUE} />
    </div>
  )
}

function Sheet({ className = '', style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={`w-layer ${className}`} style={style}>
      <div className="w-sheet" />
      {children}
    </div>
  )
}

// A box already ticked, or one that gets ticked at a given time
function Box({ at }: { at?: number }) {
  return <span className={`w-box${at !== undefined ? ' w-check' : ''}`} style={at !== undefined ? d(at) : undefined} />
}

function Toast({ from, to, text, top = 474 }: { from: number; to: number; text: string; top?: number }) {
  return (
    <span className="w-toast w-span" style={span(from, to, { top })}>
      {text}
    </span>
  )
}

/* Scene pictures */

const WRAPUP_DONE = [
  ['Étapes et bandeau vocal', 'Mergée à 09:15'],
  ['Filtre du planning', 'Review rendue à 10:02'],
  ['Relire le cadrage outbox', 'Coché à 10:58'],
]
const WRAPUP_FOCUS = [
  ['Traiter les retours outbox', 'Retours sur mes PR'],
  ['Vue recueil et documents', 'Reviews'],
  ['Bandeau hors ligne', 'Questions'],
]

function WrapupPicture() {
  const open = 10.5
  return (
    <Chrome
      specs={tabs({
        File: { on: [0, open] },
        'Wrap-up': { swap: ['Dormant', 2.5], on: [open, 99], dot: [3.2, open] },
      })}
    >
      <QueuePage className="w-out" style={d(open)} />

      <Sheet className="w-in" style={d(open + 0.1)}>
        <h3 className="w-page-title" style={pos(220, 92)}>
          Wrap-up de 11:00
        </h3>
        <span className="w-page-sub" style={pos(220, 128)}>
          3 tâches bouclées aujourd’hui · prochain point à 14:30
        </span>
        <span className="w-label" style={pos(220, 168)}>
          Fait aujourd’hui
        </span>
        {WRAPUP_DONE.map(([title, side], index) => (
          <div key={title} className="w-row w-in" style={d(open + 0.4 + index * 0.12, pos(208, 190 + index * 40))}>
            <Box />
            <span className="w-row-title">{title}</span>
            <span className="w-row-side">{side}</span>
          </div>
        ))}
        <span className="w-label" style={pos(220, 332)}>
          Focus d’ici 14:30
        </span>
        {WRAPUP_FOCUS.map(([title, side], index) => (
          <div key={title} className="w-row w-in" style={d(open + 0.8 + index * 0.12, pos(208, 354 + index * 40))}>
            {index === 0 ? <Box at={13.4} /> : <span className="w-box off" />}
            <span className={`w-row-title${index === 0 ? ' w-strike' : ''}`} style={index === 0 ? d(13.5) : undefined}>
              {title}
            </span>
            <span className="w-row-side">{side}</span>
          </div>
        ))}
      </Sheet>

      <div className="w-panel w-span" style={span(5.2, 8.6, pos(614, 76))}>
        <span className="w-panel-title" style={pos(24, 20)}>
          Réglages
          <X size={14} />
        </span>
        <span className="w-label" style={pos(24, 64)}>
          Wrap-up
        </span>
        <span className="w-panel-text" style={pos(24, 84)}>
          Rappels à heures fixes, les jours ouvrés.
        </span>
        <span className="w-time" style={pos(24, 114)}>
          11:00
        </span>
        <span className="w-time" style={pos(94, 114)}>
          14:30
        </span>
        <span className="w-time w-pop" style={d(6.9, pos(164, 114))}>
          16:30
        </span>
        <span className="w-add" style={pos(24, 156)}>
          <Plus size={12} />
          Ajouter
        </span>
        <span className="w-label" style={pos(24, 214)}>
          Daily
        </span>
        <span className="w-panel-text" style={pos(24, 236)}>
          Lancé chaque matin à <b>09:30</b>
        </span>
        <span className="w-label" style={pos(24, 290)}>
          Notifications
        </span>
        <span className="w-toggle" style={pos(24, 314)} />
      </div>

      <div className="w-banner w-span" style={span(9, 10.6, pos(624, 76))}>
        <span className="w-banner-icon">
          <Waves size={16} strokeWidth={2.4} />
        </span>
        <span className="w-banner-text">
          <b>Wrap-up de 11:00</b>
          3 tâches bouclées · focus : retours outbox
        </span>
      </div>
    </Chrome>
  )
}

const YESTERDAY = [
  ['Mergée', 'Étapes et bandeau vocal', '#1595'],
  ['Review rendue', 'Filtre du planning', '#7001'],
  ['Question répondue', 'Format des pièces', 'OFF-1031'],
  ['Clos', 'Bandeau hors ligne', 'OFF-1030'],
]
// The third intention climbs to the top: rows sit in their final order and start from the old one
const INTENTIONS = [
  { title: 'Débloquer la review de Nicolas', from: 80 },
  { title: 'Traiter les retours outbox', from: -40 },
  { title: 'Bandeau hors ligne du planning', from: -40 },
]
const HEALTH = [
  ['alert', 'Sentry', '2 régressions sur la sync'],
  ['ok', 'Datadog', 'Aucun monitor en alerte'],
  ['weak', 'Ximi', 'Rejets en hausse'],
  ['positive', 'Amplitude', 'Recueil vocal +32 %'],
]

function DailyPicture() {
  const open = 1.8
  const skill = 6.8
  return (
    <Chrome specs={tabs({ File: { on: [0, open] }, Daily: { on: [open, 99] }, 'Wrap-up': { dot: [14.4, 99] } })}>
      <QueuePage className="w-out" style={d(open)} />

      <Sheet className="w-in" style={d(open + 0.1)}>
        <h3 className="w-page-title" style={pos(60, 84)}>
          Daily
        </h3>
        <span className="w-page-sub" style={pos(60, 118)}>
          Mardi 10 novembre · généré à 09:31
        </span>

        <span className="w-label w-in" style={d(2.2, pos(60, 150))}>
          Hier
        </span>
        {YESTERDAY.map(([kind, title, ref], index) => (
          <div key={title} className="w-row daily w-in" style={d(2.3 + index * 0.1, pos(48, 170 + index * 34))}>
            <span className="w-kind">{kind}</span>
            <span className="w-row-title">{title}</span>
            <span className="w-pill">{ref}</span>
          </div>
        ))}

        <span className="w-label w-in" style={d(2.8, pos(60, 322))}>
          Aujourd’hui
        </span>
        {[1, 2, 3].map(number => (
          <span key={number} className="w-number w-in" style={d(2.9 + number * 0.08, pos(56, 342 + (number - 1) * 40))}>
            {number}
          </span>
        ))}
        {INTENTIONS.map((row, index) => (
          <div
            key={row.title}
            className={`w-row intention${index === 0 ? ' lifted' : ''}`}
            style={d(3 + index * 0.08, pos(80, 342 + index * 40, { '--from': `${row.from}px` } as CSSProperties))}
          >
            <span className="w-grip" />
            <span className="w-row-title">{row.title}</span>
          </div>
        ))}

        <span className="w-label w-in" style={d(3.2, pos(510, 150))}>
          Bloquants
        </span>
        <div className="w-row blocker w-in" style={d(3.3, pos(498, 170))}>
          <span className="w-kind blocked">Bloqué</span>
          <span className="w-row-title">Déconnecter un compte</span>
          <span className="w-row-sub">pour avancer : relancer Claire sur la clause</span>
        </div>

        <span className="w-label w-in" style={d(3.6, pos(510, 236))}>
          Santé prod
        </span>
        <span className="w-detected w-pop" style={d(skill + 0.1, pos(600, 232))}>
          Skill détecté
        </span>
        <div className="w-skill w-span" style={span(3.7, skill, pos(510, 258))}>
          <span>Aucun skill daily pour l’instant. Flux en propose un, ou t’aide à écrire le tien.</span>
          <span className="w-button small" style={pos(16, 58, { width: 130 })}>
            Utiliser le modèle
          </span>
          <span className="w-button small" style={pos(154, 58, { width: 190 })}>
            Écrire le mien avec Claude
          </span>
        </div>
        {HEALTH.map(([level, source, text], index) => (
          <div
            key={source}
            className={`w-health level-${level} w-in`}
            style={d(skill + 0.4 + index * 0.25, pos(510, 258 + index * 32))}
          >
            <span className="w-health-dot" />
            <b>{source}</b>
            <span>{text}</span>
          </div>
        ))}
        <span className="w-counts w-in" style={d(3.9, pos(510, 410))}>
          <b style={{ color: rankStyle(1).light }}>1 retour</b>
          <b style={{ color: rankStyle(2).light }}>3 reviews</b>
          <b style={{ color: rankStyle(3).light }}>1 question</b>
          <b style={{ color: rankStyle(4).light }}>1 prête à livrer</b>
        </span>
      </Sheet>

      <Toast from={15} to={99} text="Note du jour à jour dans Obsidian" />
    </Chrome>
  )
}

const ATTENTE: Card[] = [
  { ref: 'hb#6967', title: 'Générer la grille VEB depuis le planning', meta: 'Reviewée, attend l’auteur', rank: 2 },
  { ref: 'aura#230', title: 'Carnet de liaison', meta: 'Attend la CI', rank: 6 },
  { ref: 'family#220', title: 'Vieille PR oubliée', meta: 'Sans nouvelles depuis 40 j', rank: 6 },
]

function ReviewsPicture() {
  const flight = 5.4
  const open = 8.1
  const review: Card = { ref: 'hb#6967', title: 'Générer la grille VEB depuis le planning', meta: 'Review demandée par Nicolas', rank: 2 }
  const rest = [QUEUE[3], QUEUE[2], QUEUE[0]]
  return (
    <Chrome
      specs={tabs({
        File: { on: [0, open], count: [4, 3, 6.1] },
        Attente: { on: [open, 99], count: [2, 3, 6.1] },
      })}
    >
      <div className="w-layer w-out" style={d(open)}>
        <div className="w-layer w-out" style={d(6.2)}>
          <Hero
            chip="Review demandée par Nicolas"
            rank={2}
            title="Générer la grille VEB depuis le planning"
            meta="hb#6967 · demandée il y a 2 h"
            primary="Faire la review"
            secondary="Voir la PR"
          />
        </div>
        <div className="w-layer w-in" style={d(6.4)}>
          <Hero
            chip="Prête à livrer"
            rank={4}
            title="Rejouer la file hors ligne après un 401"
            meta="daca#1601 · checks verts"
            primary="Livrer"
            secondary="Voir la PR"
          />
        </div>
        <CardView card={review} selected className="w-fly" style={d(flight, pos(640, 84))}>
          <span className="w-stamp w-pop" style={d(3.4)}>
            Reviewée
          </span>
        </CardView>
        {rest.map((card, index) => (
          <CardView key={card.ref} card={card} className="w-shift" style={d(6, pos(640, 84 + index * 72))} />
        ))}
      </div>

      <div className="w-layer w-in" style={d(open + 0.1)}>
        <Hero
          chip="Reviewée, attend l’auteur"
          rank={2}
          title="Générer la grille VEB depuis le planning"
          meta="hb#6967 · revient dans la File à la prochaine demande"
          primary="Voir la PR"
          secondary="Relancer"
        />
        <Rail cards={ATTENTE} />
      </div>

      <Toast from={2.8} to={4.9} text="Review envoyée sur GitHub" top={84} />
    </Chrome>
  )
}

// Before and after, one under the other: the after window shows right of the split
function Compare({ before, after }: { before: ReactNode; after: ReactNode }) {
  return (
    <>
      {before}
      <div className="w-after">{after}</div>
    </>
  )
}

function Tag({ children, side }: { children: ReactNode; side: 'left' | 'right' }) {
  return <span className={`w-tag ${side}`}>{children}</span>
}

type ThreadState = 'busy' | 'idle' | 'paused'

const STATE_LABEL: Record<ThreadState, string> = {
  busy: 'Au travail',
  idle: 'T’attend',
  paused: 'En pause dans Claude',
}

function State({ state }: { state: ThreadState }) {
  return (
    <span className="w-state-line">
      <span className={`w-state ${state}`} />
      {STATE_LABEL[state]}
    </span>
  )
}

// The topic both windows show, and the conversation Flux keeps for it
const SESSION_TOPIC: Card = { ref: 'OFF-1048', title: 'Corriger l’enregistrement du fichier', meta: '', rank: 3 }
const SESSION_TITLE = 'Diagnostic du bug d’enregistrement'

const AFTER_RAIL: Array<{ card: Card; state: ThreadState }> = [
  { card: { ref: 'daca#1516', title: 'Sortie de RxJS, lot 1', meta: '', rank: 1 }, state: 'busy' },
  { card: SESSION_TOPIC, state: 'idle' },
  { card: { ref: 'daca#1600', title: 'Débrief direct', meta: '', rank: 4 }, state: 'paused' },
]

const SESSION_HERO = {
  rank: 3 as Rank,
  title: 'Corriger l’enregistrement du fichier',
  primary: 'Ouvrir dans Claude',
  secondary: 'Voir le ticket',
}

// When Claude hands back in the before window, and when the topic leaves En cours
const HANDS_BACK = 2.6
const LEAVES = 3.6

function SessionsPicture() {
  const before = (
    <Chrome specs={tabs({ 'En cours': { on: [0, 99], count: [1, 0, LEAVES] } })}>
      {/* The card slides out of the rail first, then the page empties */}
      <div className="w-layer w-out" style={d(LEAVES + 0.2)}>
        <Hero chip="Agent au travail" meta="OFF-1048 · Claude travaille depuis 40 min" {...SESSION_HERO} />
        <CardView card={SESSION_TOPIC} selected className="w-leave-rail" style={d(LEAVES, pos(640, 84))}>
          <span className="w-card-meta w-swap-meta">
            <span className="w-out" style={d(HANDS_BACK)}>
              <State state="busy" />
            </span>
            <span className="w-in" style={d(HANDS_BACK + 0.1)}>
              <State state="idle" />
            </span>
          </span>
        </CardView>
      </div>
      <h3 className="w-empty w-in" style={d(LEAVES + 0.3, pos(48, 210))}>
        Rien ici pour le moment.
      </h3>
      <Tag side="left">Avant</Tag>
    </Chrome>
  )
  const after = (
    <Chrome specs={tabs({ 'En cours': { on: [0, 99], count: 3 } })}>
      <div className="w-layer">
        <Hero chip="Claude t’attend" meta="OFF-1048 · conversation ouverte depuis 2 h" {...SESSION_HERO} />
        <div className="w-links" style={pos(48, 384)}>
          <span className="w-label">Liens</span>
          <div className="w-link conversation w-press" style={d(9.3)}>
            <span className="w-link-kind claude">
              <BrandIcon brand="claude" size={13} />
            </span>
            <span className="w-link-text">
              <b>{SESSION_TITLE}</b>
              <State state="idle" />
            </span>
          </div>
          <div className="w-link">
            <span className="w-link-kind ticket">
              <BrandIcon brand="linear" size={13} />
            </span>
            <span className="w-link-text">
              <b>OFF-1048</b>
              <span className="w-state-line">Impossible d’enregistrer le fichier</span>
            </span>
          </div>
        </div>
        {AFTER_RAIL.map(({ card, state }, index) => (
          <CardView key={card.ref} card={card} selected={card === SESSION_TOPIC} style={pos(640, 84 + index * 72)}>
            <span className="w-card-meta">
              <State state={state} />
            </span>
          </CardView>
        ))}
      </div>
      <Toast from={10.1} to={11.3} text="Conversation rouverte dans Claude" top={84} />
      <Tag side="right">Maintenant</Tag>
    </Chrome>
  )
  return <Compare before={before} after={after} />
}

/* Scenes */

interface Scene {
  id: string
  rank: Rank
  ms: number
  kicker: string
  headline: string
  // When the headline gives way to the window
  headlineUntil: number
  captions: Array<[number, string]>
  cam: Cam[]
  cursor: Pt[]
  clicks: Click[]
  focus?: Focus[]
  // A before/after scene: where the split line sits over time
  split?: Split[]
  Picture: () => ReactNode
}

export const SCENES: Scene[] = [
  {
    id: 'sessions',
    rank: 0,
    ms: 15000,
    kicker: 'Sessions Claude',
    headline: 'Tes conversations ne se perdent plus.',
    headlineUntil: 1.4,
    captions: [
      [1.4, 'Avant : Claude te rend la main…'],
      [LEAVES, '…et le sujet quitte En cours, sa conversation avec.'],
      [5.8, 'Maintenant, il reste en cours tant qu’il est ouvert.'],
      [7.8, 'La conversation est dans ses liens : un clic la rouvre.'],
      [11.3, 'Au travail, t’attend ou en pause : tout ce que tu as lancé.'],
    ],
    cam: [
      cam(1.2, GLOBAL),
      cam(1.9, WHOLE),
      cam(7.2, WHOLE),
      [7.9, 1.5, 300, 452],
      [9.5, 1.5, 300, 452],
      cam(10.1, WHOLE),
    ],
    cursor: [
      [0, 520, 560, 0],
      [7.5, 520, 560, 0],
      [7.8, 520, 560],
      [9, 196, 430],
      [9.5, 196, 430],
      [10.3, 380, 540],
      [10.6, 380, 540, 0],
    ],
    clicks: [[9.3, 196, 430]],
    focus: [
      [2, 3.5, 640, 84, 280, 66, 16],
      [7.9, 9.5, 36, 374, 424, 140, 16],
      [11.3, 12.4, 628, 72, 304, 234, 20],
    ],
    // Ends between the page and the rail: the empty page before, the three topics now
    split: [
      [0, 960, 0],
      [5.7, 960, 0],
      [5.8, 960],
      [7, 0],
      [7.1, 0, 0],
      [12.4, 0, 0],
      [12.5, 0],
      [13.5, 620],
    ],
    Picture: SessionsPicture,
  },
  {
    id: 'wrapup',
    rank: 4,
    ms: 16000,
    kicker: 'Wrap-up',
    headline: 'Trois points. Rien d’oublié.',
    headlineUntil: 1.3,
    captions: [
      [1.3, 'Dormant laisse sa place au Wrap-up.'],
      [4.5, 'Tes heures se règlent dans les réglages.'],
      [8.8, 'À l’heure dite, Flux te fait signe.'],
      [11.2, 'Coche ce qui est fait, passe au suivant.'],
    ],
    cam: [
      cam(1.2, GLOBAL),
      [1.9, 2.05, 480, 58],
      [3.9, 2.05, 480, 58],
      cam(4.5, WHOLE),
      cam(5.4, WHOLE),
      [6, 1.3, 779, 298],
      [8.4, 1.3, 779, 298],
      cam(9, WHOLE),
      cam(11, WHOLE),
      [11.8, 1.2, 480, 296],
    ],
    cursor: [
      [0, 760, 560, 0],
      [1.2, 760, 560],
      [2.2, 605, 34],
      [3.6, 618, 46],
      [4.6, 900, 120],
      [5, 926, 32],
      [6.2, 700, 260],
      [6.6, 686, 246],
      [7.6, 720, 330],
      [9.6, 800, 200],
      [10.2, 784, 110],
      [11.8, 560, 470],
      [13.1, 229, 374],
      [14.4, 420, 520],
    ],
    clicks: [
      [5.1, 926, 32],
      [6.75, 686, 246],
      [10.35, 784, 110],
      [13.3, 229, 374],
    ],
    focus: [
      [1.9, 4.1, 235, 12, 490, 40, 20],
      [5.9, 8.5, 614, 76, 330, 370, 20],
      [9.1, 10.5, 624, 76, 316, 62, 16],
    ],
    Picture: WrapupPicture,
  },
  {
    id: 'daily',
    rank: 3,
    ms: 18000,
    kicker: 'Daily',
    headline: 'Le daily, en quatre blocs.',
    headlineUntil: 1.3,
    captions: [
      [1.3, 'Hier, aujourd’hui, bloquants, santé prod.'],
      [5, 'Un modèle prêt, ou le tien écrit avec Claude.'],
      [9.2, 'Glisse pour choisir l’ordre du jour.'],
      [13.6, 'Repris par le wrap-up, exporté dans Obsidian.'],
    ],
    cam: [
      cam(1.2, GLOBAL),
      cam(2.1, WHOLE),
      cam(5, WHOLE),
      [5.6, 1.55, 705, 292],
      [9, 1.55, 705, 292],
      [9.6, 1.6, 265, 400],
      [13.4, 1.6, 265, 400],
      cam(14, WHOLE),
    ],
    cursor: [
      [0, 700, 560, 0],
      [1, 700, 560],
      [1.7, 686, 34],
      [3.5, 620, 200],
      [5.8, 600, 250],
      [6.4, 591, 331],
      [7.6, 640, 400],
      [9.6, 300, 480],
      [10.1, 110, 442],
      [10.4, 110, 442],
      [11.2, 110, 362],
      [12.2, 260, 520],
      [14, 700, 480],
      [15, 780, 560],
    ],
    clicks: [
      [1.8, 686, 34],
      [6.55, 591, 331],
      [10.2, 110, 442],
      [11.3, 110, 362],
    ],
    focus: [
      [5.5, 9.1, 498, 226, 404, 172, 14],
      [9.6, 13.4, 44, 314, 430, 160, 14],
    ],
    Picture: DailyPicture,
  },
  {
    id: 'reviews',
    rank: 5,
    ms: 11000,
    kicker: 'Reviews',
    headline: 'Déjà reviewée ? Elle attend.',
    headlineUntil: 1.4,
    captions: [
      [1.4, 'Tu rends ta review sur GitHub.'],
      [5, 'Flux la range en Attente. Rien à régler.'],
      [8.2, 'Une nouvelle demande la ramène dans la File.'],
    ],
    cam: [
      cam(1.4, GLOBAL),
      [2.1, 1.2, 482, 250],
      [4.6, 1.2, 482, 250],
      cam(5.1, WHOLE),
      cam(8, WHOLE),
      [8.8, 1.1, 520, 250],
    ],
    cursor: [
      [0, 700, 560, 0],
      [1.4, 700, 560],
      [2.2, 123, 334],
      [3.6, 360, 420],
      [5.2, 520, 300],
      [7.6, 445, 34],
      [9.2, 560, 440],
    ],
    clicks: [
      [2.4, 123, 334],
      [8, 445, 34],
    ],
    Picture: ReviewsPicture,
  },
]

function Words({ text, delay }: { text: string; delay: number }) {
  return (
    <h1 className="spot-headline" aria-label={text}>
      {text.split(' ').map((word, index) => (
        <span key={`${word}-${index}`} style={d(delay + index * 0.08)} aria-hidden="true">
          {word}
        </span>
      ))}
    </h1>
  )
}

function Pointer() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true">
      <path
        d="M1.5 1.5v16.2l4.1-3.9 2.7 6.3 3-1.3-2.7-6.2h5.9z"
        fill="#fff"
        stroke="#0a0c12"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SceneView({ scene, leaving }: { scene: Scene; leaving: boolean }) {
  const total = scene.ms / 1000
  const camName = `spot-cam-${scene.id}`
  const cursorName = `spot-cursor-${scene.id}`
  const splitName = `spot-split-${scene.id}`
  const clipName = `spot-clip-${scene.id}`
  const split = scene.split ?? []
  const css = [
    split.length > 0
      ? keyframes(
          splitName,
          total,
          split.map(([t, x, shown = 1]) => [t, `transform: translateX(${x}px); opacity: ${shown};`]),
        )
      : '',
    split.length > 0
      ? keyframes(clipName, total, split.map(([t, x]) => [t, `clip-path: inset(0 0 0 ${x}px);`]))
      : '',
    keyframes(camName, total, scene.cam.map(step => [step[0], `transform: ${camTransform(step)};`])),
    scene.cursor.length > 0
      ? keyframes(
          cursorName,
          total,
          scene.cursor.map(([t, x, y, shown = 1]) => [t, `transform: translate(${x}px, ${y}px); opacity: ${shown};`]),
        )
      : '',
  ].join('\n')
  const Picture = scene.Picture
  const delay = 0.25
  const run = (name: string) => `${name} ${scene.ms}ms linear both`
  return (
    <div
      className={`spot-scene${leaving ? ' leaving' : ''}`}
      style={tint(rankStyle(scene.rank))}
      aria-hidden={leaving}
    >
      <style>{css}</style>
      <div className="spot-stage">
        <div
          className="spot-cam"
          style={
            {
              transform: camTransform(scene.cam[scene.cam.length - 1]),
              animation: run(camName),
              // The after window of a before/after scene clips itself on this
              '--split-clip': split.length > 0 ? run(clipName) : 'none',
            } as CSSProperties
          }
        >
          <Picture />
          {split.length > 0 && (
            <span className="spot-split" style={{ animation: run(splitName) }}>
              <span className="spot-split-knob">
                <ChevronsLeftRight size={14} strokeWidth={2.4} />
              </span>
            </span>
          )}
          {scene.focus?.map(([from, to, x, y, w, h, r]) => (
            <span
              key={from}
              className="spot-focus"
              style={span(from, to, { left: x, top: y, width: w, height: h, borderRadius: r })}
            />
          ))}
          {scene.clicks.map(([t, x, y]) => (
            <span key={t} className="spot-click" style={d(t, pos(x, y))} />
          ))}
          {scene.cursor.length > 0 && (
            <span className="spot-cursor" style={{ animation: run(cursorName) }}>
              <Pointer />
            </span>
          )}
        </div>
      </div>
      <header className="spot-head" style={{ '--until': `${scene.headlineUntil}s` } as CSSProperties}>
        <p className="spot-kicker" style={d(delay - 0.15)}>
          {scene.kicker}
        </p>
        <Words text={scene.headline} delay={delay} />
      </header>
      <div className="spot-captions">
        {scene.captions.map(([t, text], index) => (
          <p key={t} className="spot-beat" style={span(t, scene.captions[index + 1]?.[0] ?? total + 1)}>
            {text}
          </p>
        ))}
      </div>
    </div>
  )
}

// A scene as played: the take is bumped on every jump, so a scene played again starts over
interface Cut {
  scene: number
  take: number
}

// Plays the scenes it is given, in order, then hands back
export function Spot({ playlist, onEnd }: { playlist: string[]; onEnd(): void }) {
  const scenes = useMemo(
    () => playlist.flatMap(id => SCENES.filter(scene => scene.id === id)),
    [playlist],
  )
  const [cut, setCut] = useState<Cut>({ scene: 0, take: 0 })
  // The scene fading out keeps its element, so it holds its last frame instead of replaying
  const [leaving, setLeaving] = useState<Cut | null>(null)
  const [playing, setPlaying] = useState(true)
  const scene = cut.scene
  const root = useRef<HTMLDivElement>(null)
  const elapsed = useRef(0)
  const fills = useRef<Array<HTMLSpanElement | null>>([])

  // The 960 by 600 window fits the frame whatever its size
  useEffect(() => {
    const element = root.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => {
      element.style.setProperty('--fit', String(Math.min(element.clientWidth / W, element.clientHeight / H)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const paint = useCallback((index: number, ratio: number) => {
    fills.current.forEach((fill, position) => {
      if (!fill) return
      const value = position < index ? 1 : position > index ? 0 : ratio
      fill.style.transform = `scaleX(${value})`
    })
  }, [])

  const go = useCallback(
    (index: number) => {
      if (index >= scenes.length) {
        onEnd()
        return
      }
      const target = Math.max(0, index)
      setLeaving(current => (target === cut.scene ? current : cut))
      setCut({ scene: target, take: cut.take + 1 })
      elapsed.current = 0
      paint(target, 0)
    },
    [cut, onEnd, paint, scenes.length],
  )

  useEffect(() => {
    if (leaving === null) return undefined
    const timer = setTimeout(() => setLeaving(null), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  useEffect(() => {
    if (!playing) return undefined
    let last = performance.now()
    let frame = 0
    const step = (now: number) => {
      elapsed.current += now - last
      last = now
      const ms = scenes[scene].ms
      paint(scene, Math.min(1, elapsed.current / ms))
      if (elapsed.current >= ms) go(scene + 1)
      else frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, scene, go, paint, scenes])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A focused button answers Space itself
      if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        setPlaying(value => !value)
      } else if (event.key === 'ArrowRight') go(scene + 1)
      else if (event.key === 'ArrowLeft') go(elapsed.current > 1200 ? scene : scene - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scene, go])

  const current = scenes[scene]
  return (
    <div ref={root} className={`spot${playing ? '' : ' paused'}`}>
      <Stage style={rankStyle(current.rank)} drift={playing} />
      <div className="spot-veil" aria-hidden="true" />
      {/* The whole picture pauses on click, like a video; the button below does the same from the keyboard */}
      <div className="spot-surface" onClick={() => setPlaying(value => !value)}>
        {(leaving ? [leaving, cut] : [cut]).map(item => (
          <SceneView key={`${item.scene}-${item.take}`} scene={scenes[item.scene]} leaving={item !== cut} />
        ))}
      </div>

      <div className="spot-controls">
        <button
          type="button"
          className="round small glass"
          aria-label={playing ? 'Pause' : 'Lecture'}
          title="Espace"
          onClick={() => setPlaying(value => !value)}
        >
          {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
        <div className="spot-segments">
          {scenes.map((entry, index) => (
            <button
              type="button"
              key={entry.id}
              aria-label={`${entry.kicker} : ${entry.headline}`}
              aria-current={index === scene ? 'step' : undefined}
              onClick={() => go(index)}
            >
              <span ref={element => void (fills.current[index] = element)} />
            </button>
          ))}
        </div>
        <button type="button" className="pill glass small" onClick={onEnd}>
          Passer
        </button>
      </div>
    </div>
  )
}
