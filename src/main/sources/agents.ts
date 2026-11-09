import { run } from '../exec'
import { BIN } from '../paths'
import type { LiveSession } from '../engine/ball'

interface RawAgent {
  sessionId: string
  status?: string
}

export function normalizeAgents(agents: RawAgent[]): LiveSession[] {
  return agents.map(agent => ({
    session: agent.sessionId,
    status: agent.status === 'busy' ? 'busy' : 'idle',
  }))
}

export async function fetchAgents(): Promise<LiveSession[]> {
  const output = await run(BIN.claude, ['agents', '--json'], { timeoutMs: 15_000 })
  return normalizeAgents(JSON.parse(output) as RawAgent[])
}
