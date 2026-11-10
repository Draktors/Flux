import { Globe } from 'lucide-react'
import {
  siClaude,
  siFigma,
  siGithub,
  siGooglecalendar,
  siJira,
  siLinear,
  siNotion,
  siObsidian,
  siSentry,
  type SimpleIcon,
} from 'simple-icons'

export type Brand =
  | 'github'
  | 'linear'
  | 'jira'
  | 'claude'
  | 'obsidian'
  | 'calendar'
  | 'notion'
  | 'figma'
  | 'sentry'

const ICONS: Record<Brand, SimpleIcon> = {
  github: siGithub,
  linear: siLinear,
  jira: siJira,
  claude: siClaude,
  obsidian: siObsidian,
  calendar: siGooglecalendar,
  notion: siNotion,
  figma: siFigma,
  sentry: siSentry,
}

const HOSTS: Array<[Brand, (host: string) => boolean]> = [
  // github.com, GitHub Enterprise Cloud (*.ghe.com) and self-hosted github.* hosts
  ['github', host => host === 'github.com' || host.endsWith('.ghe.com') || host.startsWith('github.')],
  ['linear', host => host === 'linear.app'],
  ['jira', host => host.endsWith('.atlassian.net')],
  ['claude', host => host === 'claude.ai' || host === 'claude.com' || host.endsWith('.claude.ai')],
  ['calendar', host => host === 'calendar.google.com'],
  ['notion', host => host.endsWith('notion.so') || host.endsWith('notion.site')],
  ['figma', host => host.endsWith('figma.com')],
  ['sentry', host => host === 'sentry.io' || host.endsWith('.sentry.io')],
]

export function brandOf(url: string | undefined): Brand | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'claude:') return 'claude'
    if (parsed.protocol === 'obsidian:') return 'obsidian'
    const host = parsed.hostname.toLowerCase()
    return HOSTS.find(([, matches]) => matches(host))?.[0] ?? null
  } catch {
    return null
  }
}

export function BrandIcon({ brand, size = 14 }: { brand: Brand; size?: number }) {
  return (
    <svg
      className="brand-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={ICONS[brand].path} />
    </svg>
  )
}

// The logo of where a link leads, or a globe for any other website
export function LinkIcon({ url, size = 14 }: { url: string | undefined; size?: number }) {
  const brand = brandOf(url)
  return brand ? (
    <BrandIcon brand={brand} size={size} />
  ) : (
    <Globe size={size} className="brand-icon" aria-hidden="true" />
  )
}
