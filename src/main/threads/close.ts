import type { Topic } from '../../shared/types'
import type { LiveSession } from '../engine/ball'
import { closeWorkspace } from './cmux'

export async function closeThreads(topic: Topic, sessions: LiveSession[]): Promise<void> {
  for (const thread of topic.threads) {
    if (!thread.workspace) continue
    const busy = sessions.some(s => s.session === thread.session && s.status === 'busy')
    if (busy) {
      thread.closing = true
      continue
    }
    try {
      await closeWorkspace(thread.workspace)
      thread.workspace = undefined
      thread.closing = undefined
    } catch {
      thread.closing = true
    }
  }
}
