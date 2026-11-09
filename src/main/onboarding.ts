import type { CheckResult } from '../shared/types'

import { run } from './exec'
import { BIN } from './paths'
import { fetchCalendar } from './sources/calendar'
import { GITHUB_HOST } from './sources/github'

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql'

function failure(error: unknown): CheckResult {
  return { ok: false, detail: (error as Error).message }
}

export async function checkGithub(): Promise<CheckResult> {
  try {
    const login = await run(BIN.gh, ['api', '--hostname', GITHUB_HOST, 'user', '--jq', '.login'], {
      timeoutMs: 15_000,
    })
    return { ok: true, detail: `Connecté en tant que ${login.trim()} sur ${GITHUB_HOST}` }
  } catch {
    return {
      ok: false,
      detail: `gh n'est pas connecté à ${GITHUB_HOST}. Lance : gh auth login --hostname ${GITHUB_HOST}`,
    }
  }
}

export async function checkLinearKey(key: string): Promise<CheckResult> {
  try {
    const response = await fetch(LINEAR_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: key.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { name } }' }),
      signal: AbortSignal.timeout(15_000),
    })
    const payload = (await response.json()) as { data?: { viewer?: { name: string } } }
    const name = payload.data?.viewer?.name
    if (!response.ok || !name) return { ok: false, detail: 'Linear refuse cette clef.' }
    return { ok: true, detail: `Connecté en tant que ${name}` }
  } catch (error) {
    return failure(error)
  }
}

export async function checkCalendarUrl(url: string): Promise<CheckResult> {
  if (!/^https:\/\//i.test(url.trim())) {
    return { ok: false, detail: 'L’adresse doit commencer par https://' }
  }
  try {
    const meetings = await fetchCalendar(url.trim())
    const count = meetings.length
    return {
      ok: true,
      detail:
        count === 0
          ? 'Agenda lu, aucun rendez-vous à venir'
          : `Agenda lu, ${count} rendez-vous à venir`,
    }
  } catch (error) {
    return failure(error)
  }
}
