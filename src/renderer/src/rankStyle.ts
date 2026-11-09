import {
  Bot,
  CircleHelp,
  Eye,
  Layers,
  MessageSquare,
  NotebookPen,
  Rocket,
  Send,
  type LucideIcon,
} from 'lucide-react'
import type { Rank } from '../../shared/types'

export interface RankStyle {
  icon: LucideIcon
  light: string
  main: string
  deep: string
}

const STYLES: Record<Rank, RankStyle> = {
  0: { icon: Send, light: '#ffc98a', main: '#d9690f', deep: '#2b1003' },
  1: { icon: MessageSquare, light: '#ff9ccf', main: '#c8286e', deep: '#2c0519' },
  2: { icon: Eye, light: '#d3a8ff', main: '#7832c8', deep: '#170838' },
  3: { icon: CircleHelp, light: '#7fe9ff', main: '#0a93b3', deep: '#03212e' },
  4: { icon: Rocket, light: '#86e9ae', main: '#15994a', deep: '#032612' },
  5: { icon: Bot, light: '#8fc1ff', main: '#2263d6', deep: '#05143f' },
  6: { icon: Layers, light: '#b4bfff', main: '#4553c4', deep: '#0c1032' },
}

const NOTE_STYLE: RankStyle = { icon: NotebookPen, light: '#c9ccd6', main: '#566078', deep: '#10131d' }

export function rankStyle(rank: Rank | null): RankStyle {
  return rank === null ? NOTE_STYLE : STYLES[rank]
}

export function tint(style: RankStyle): Record<string, string> {
  return { '--tint-light': style.light, '--tint-main': style.main, '--tint-deep': style.deep }
}
