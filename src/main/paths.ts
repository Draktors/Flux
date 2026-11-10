import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG } from './config'

const HOME = homedir()

export const BIN = {
  gh: '/opt/homebrew/bin/gh',
  git: '/usr/bin/git',
  osascript: '/usr/bin/osascript',
  open: '/usr/bin/open',
  claude: join(HOME, '.local/bin/claude'),
}

export const VAULT = CONFIG.paths.vault
export const TOPICS_DIR = join(VAULT, 'flux')
export const ARCHIVE_DIR = join(TOPICS_DIR, 'archive')
export const DAILY_DIR = join(VAULT, 'daily')
export const REPOS_DIR = CONFIG.paths.repos
export const DAILY_COMMAND = CONFIG.paths.dailyCommand
export const CLAUDE_PROJECTS_DIR = join(HOME, '.claude/projects')

export const STATE_DIR = join(HOME, '.flux')
export const SNAPSHOT_FILE = join(STATE_DIR, 'snapshot.json')
export const NOTIFY_FILE = join(STATE_DIR, 'notify.json')
export const SETTINGS_FILE = join(STATE_DIR, 'settings.json')
export const SECRETS_FILE = join(STATE_DIR, 'secrets.json')
export const TRIAGE_FILE = join(STATE_DIR, 'triage.json')
export const CALLS_FILE = join(STATE_DIR, 'calls.json')
export const THREADS_DIR = join(STATE_DIR, 'threads')
