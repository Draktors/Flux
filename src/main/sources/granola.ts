import { createServer, type Server } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

const SERVER = new URL('https://mcp.granola.ai/mcp')
// Fixed loopback port: the redirect registered with Granola must not change between launches
const CALLBACK_PORT = 41783
const REDIRECT = `http://127.0.0.1:${CALLBACK_PORT}/callback`
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const BATCH = 10

export interface GranolaMeeting {
  id: string
  title: string
  at: string
  url: string
  updatedAt: string | null
}

export interface GranolaNote extends GranolaMeeting {
  participants: string[]
  summary: string | null
}

// What Flux keeps between launches, encrypted with the other secrets
export interface GranolaAuth {
  client?: OAuthClientInformationFull
  tokens?: OAuthTokens
  verifier?: string
}

export interface GranolaStore {
  read(): GranolaAuth
  write(auth: GranolaAuth): void
}

function decode(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of tag.matchAll(/([a-z_]+)="([^"]*)"/g)) result[match[1]] = decode(match[2])
  return result
}

function meetingFrom(tag: string): GranolaMeeting | null {
  const fields = attributes(tag)
  if (!fields.id) return null
  return {
    id: fields.id,
    title: fields.title || 'Appel sans titre',
    at: fields.meeting_at || fields.created_at || '',
    url: fields.url || `https://notes.granola.ai/d/${fields.id}`,
    updatedAt: fields.updated_at || null,
  }
}

// list_meetings answers with <meeting …/> blocks inside <meetings_data>
export function parseMeetingList(text: string): { meetings: GranolaMeeting[]; cursor: string | null } {
  const meetings = [...text.matchAll(/<meeting\s[^>]*>/g)].flatMap(match => meetingFrom(match[0]) ?? [])
  const cursor = /next_cursor="([^"]+)"/.exec(text)?.[1] ?? null
  return { meetings, cursor }
}

function participantsOf(block: string): string[] {
  const list = /<known_participants[^>]*>([\s\S]*?)<\/known_participants>/.exec(block)?.[1] ?? ''
  return list
    .split('\n')
    .map(line => line.trim().replace(/\s*\([^)]*@[^)]*\)\s*$/, '').replace(/\s*\(note creator\)/, ''))
    .filter(Boolean)
}

// get_meetings adds the participants and the summary in Markdown
export function parseMeetings(text: string): GranolaNote[] {
  return [...text.matchAll(/(<meeting\s[^>]*>)([\s\S]*?)<\/meeting>/g)].flatMap(match => {
    const meeting = meetingFrom(match[1])
    if (!meeting) return []
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(match[2])?.[1]?.trim() ?? null
    return [{ ...meeting, participants: participantsOf(match[2]), summary: summary ? decode(summary) : null }]
  })
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? []
  const text = content.map(part => part.text ?? '').join('\n')
  if ((result as { isError?: boolean }).isError) throw new Error(text || 'Granola a refusé la requête')
  return text
}

class Provider implements OAuthClientProvider {
  // Set while a sign-in waits in the browser
  pending: ((url: URL) => void) | null = null

  constructor(private readonly store: GranolaStore) {}

  get redirectUrl(): string {
    return REDIRECT
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Flux',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  clientInformation() {
    return this.store.read().client
  }

  saveClientInformation(client: OAuthClientInformationFull) {
    this.store.write({ ...this.store.read(), client })
  }

  tokens() {
    return this.store.read().tokens
  }

  saveTokens(tokens: OAuthTokens) {
    this.store.write({ ...this.store.read(), tokens })
  }

  saveCodeVerifier(verifier: string) {
    this.store.write({ ...this.store.read(), verifier })
  }

  codeVerifier() {
    const verifier = this.store.read().verifier
    if (!verifier) throw new Error('Connexion Granola interrompue, recommence')
    return verifier
  }

  redirectToAuthorization(url: URL) {
    // Outside a sign-in the user asked for, an expired session just reports as disconnected
    if (!this.pending) throw new UnauthorizedError('Granola demande de te reconnecter')
    this.pending(url)
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier') {
    const auth = this.store.read()
    if (scope === 'all') return this.store.write({})
    if (scope === 'client') delete auth.client
    if (scope === 'tokens') delete auth.tokens
    if (scope === 'verifier') delete auth.verifier
    this.store.write(auth)
  }
}

function waitForCode(): { code: Promise<string>; server: Server } {
  let server!: Server
  const code = new Promise<string>((resolve, reject) => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', REDIRECT)
      if (url.pathname !== '/callback') {
        response.writeHead(404).end()
        return
      }
      const value = url.searchParams.get('code')
      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        `<meta charset="utf-8"><body style="font:16px -apple-system;padding:40px">${
          value ? 'Flux est connecté à Granola. Tu peux fermer cet onglet.' : 'Connexion à Granola refusée.'
        }</body>`,
      )
      if (value) resolve(value)
      else reject(new Error(error ?? 'Connexion à Granola refusée'))
    })
    server.on('error', reject)
    server.listen(CALLBACK_PORT, '127.0.0.1')
  })
  return { code, server }
}

export class Granola {
  private readonly provider: Provider
  private client: Client | null = null

  constructor(store: GranolaStore) {
    this.provider = new Provider(store)
  }

  get hasSession(): boolean {
    return Boolean(this.provider.tokens())
  }

  private async open(): Promise<Client> {
    if (this.client) return this.client
    const transport = new StreamableHTTPClientTransport(SERVER, { authProvider: this.provider })
    const client = new Client({ name: 'flux', version: '0.1.0' })
    await client.connect(transport)
    this.client = client
    return client
  }

  // Opens Granola's sign-in in the browser and waits for its answer on the loopback port
  async signIn(openBrowser: (url: string) => void): Promise<void> {
    await this.close()
    const { code, server } = waitForCode()
    const timer = setTimeout(() => server.close(), SIGN_IN_TIMEOUT_MS)
    try {
      this.provider.pending = url => openBrowser(url.toString())
      const transport = new StreamableHTTPClientTransport(SERVER, { authProvider: this.provider })
      const client = new Client({ name: 'flux', version: '0.1.0' })
      try {
        await client.connect(transport)
        this.client = client
        return
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error
      }
      await transport.finishAuth(await code)
      await this.open()
    } finally {
      this.provider.pending = null
      clearTimeout(timer)
      server.close()
    }
  }

  async signOut(): Promise<void> {
    await this.close()
    this.provider.invalidateCredentials('all')
  }

  async close(): Promise<void> {
    const client = this.client
    this.client = null
    await client?.close().catch(() => undefined)
  }

  private async call(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      const client = await this.open()
      return textOf(await client.callTool({ name, arguments: args }))
    } catch (error) {
      // A dropped session reconnects once; a refused token stays an error for the caller
      await this.close()
      if (error instanceof UnauthorizedError) throw error
      const client = await this.open()
      return textOf(await client.callTool({ name, arguments: args }))
    }
  }

  async email(): Promise<string | null> {
    const text = await this.call('get_account_info', {})
    return /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(text)?.[0] ?? null
  }

  // Every meeting Granola keeps (the last 30 days on the free plan)
  async meetings(): Promise<GranolaMeeting[]> {
    const meetings: GranolaMeeting[] = []
    let cursor: string | null = null
    do {
      const page = parseMeetingList(
        await this.call('list_meetings', {
          time_range: 'last_30_days',
          ...(cursor ? { cursor } : {}),
        }),
      )
      meetings.push(...page.meetings)
      cursor = page.cursor
    } while (cursor && meetings.length < 1_000)
    return meetings
  }

  async notes(ids: string[]): Promise<GranolaNote[]> {
    const notes: GranolaNote[] = []
    for (let index = 0; index < ids.length; index += BATCH) {
      const text = await this.call('get_meetings', {
        meeting_ids: ids.slice(index, index + BATCH),
        max_participants: 20,
        attachments: 'none',
      })
      notes.push(...parseMeetings(text))
    }
    return notes
  }
}
