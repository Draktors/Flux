import type { CheckResult } from '../shared/types'

import { run } from './exec'
import { BIN } from './paths'
import { calendarUrl, fetchCalendar } from './sources/calendar'
import { checkJira as readJiraUser } from './sources/jira'
import { GITHUB_HOST, tokenArgs } from './sources/github'

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql'

function failure(error: unknown): CheckResult {
  return { ok: false, detail: (error as Error).message }
}

export async function checkGithub(account: string | null = null): Promise<CheckResult> {
  try {
    // Ask for the chosen account's token first so the check reads GitHub as that account
    const token = (await run(BIN.gh, tokenArgs(account), { timeoutMs: 15_000 })).trim()
    const login = await run(BIN.gh, ['api', '--hostname', GITHUB_HOST, 'user', '--jq', '.login'], {
      timeoutMs: 15_000,
      env: { ...process.env, GH_TOKEN: token, GH_ENTERPRISE_TOKEN: token },
    })
    return { ok: true, detail: `Connecté en tant que ${login.trim()} sur ${GITHUB_HOST}` }
  } catch {
    const who = account ? `avec le compte ${account} ` : ''
    return {
      ok: false,
      detail: `gh n'est pas connecté ${who}à ${GITHUB_HOST}. Lance : gh auth login --hostname ${GITHUB_HOST}`,
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

export function normalizeJiraSite(site: string): string {
  const trimmed = site.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export async function checkJira(site: string, email: string, token: string): Promise<CheckResult> {
  const url = normalizeJiraSite(site)
  if (!url || !email.trim() || !token.trim()) {
    return { ok: false, detail: 'Il faut le site, l’e-mail et le jeton.' }
  }
  try {
    const name = await readJiraUser({ site: url, email: email.trim(), token: token.trim() })
    return { ok: true, detail: `Connecté en tant que ${name}` }
  } catch (error) {
    const message = (error as Error).message
    return {
      ok: false,
      detail: /401|403|unauthori/i.test(message) ? 'Jira refuse cet e-mail ou ce jeton.' : message,
    }
  }
}

export async function checkCalendarUrl(url: string): Promise<CheckResult> {
  if (!/^https:\/\//i.test(calendarUrl(url))) {
    return { ok: false, detail: 'L’adresse doit commencer par https:// ou webcal://' }
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
