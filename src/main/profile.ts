import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROFILE_IDS, PROFILE_LABEL, type ProfileId, type Profiles, type ProfilesPatch } from '../shared/profiles'

// Kept apart from config and paths: both are computed from the profile this file picks

export interface StoredProfiles {
  active: ProfileId
  perso: boolean
}

// Pro lives in ~/.flux itself, as before profiles existed, so nothing moves; Perso gets its own folder
export function profileDir(root: string, id: ProfileId): string {
  return id === 'pro' ? root : join(root, 'profiles', id)
}

// Anything unreadable falls back to Pro alone, and Perso is never active once removed
export function parseProfiles(raw: unknown): StoredProfiles {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<StoredProfiles>
  const perso = value.perso === true
  return { active: perso && value.active === 'perso' ? 'perso' : 'pro', perso }
}

// Switching to Perso turns it on; removing Perso while on it goes back to Pro
export function nextProfiles(stored: StoredProfiles, patch: ProfilesPatch): StoredProfiles {
  const perso = patch.active === 'perso' ? true : (patch.perso ?? stored.perso)
  return parseProfiles({ active: patch.active ?? stored.active, perso })
}

const ROOT = join(homedir(), '.flux')
const PROFILES_FILE = join(ROOT, 'profiles.json')

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function readProfiles(): StoredProfiles {
  return parseProfiles(readJson(PROFILES_FILE))
}

// Read once at launch: every path and the config hang on it, so a switch relaunches Flux
export const ACTIVE_PROFILE: ProfileId = readProfiles().active
export const PROFILE_DIR = profileDir(ROOT, ACTIVE_PROFILE)

function onboarded(id: ProfileId): boolean {
  const settings = readJson(join(profileDir(ROOT, id), 'settings.json')) as { onboarded?: unknown } | null
  return settings?.onboarded === true
}

export function profiles(): Profiles {
  return {
    active: ACTIVE_PROFILE,
    perso: readProfiles().perso,
    list: PROFILE_IDS.map(id => ({ id, label: PROFILE_LABEL[id], onboarded: onboarded(id) })),
  }
}

// Returns true when Flux has to relaunch on the other profile
export function saveProfiles(patch: ProfilesPatch): boolean {
  const next = nextProfiles(readProfiles(), patch)
  mkdirSync(ROOT, { recursive: true })
  writeFileSync(PROFILES_FILE, JSON.stringify(next, null, 2))
  return next.active !== ACTIVE_PROFILE
}
