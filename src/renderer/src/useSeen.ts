import { useCallback, useEffect, useState } from 'react'
import type { TopicView } from '../../shared/types'

const KEY = 'flux.seen'

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function write(seen: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen))
  } catch {
    return
  }
}

function latest(view: TopicView): string {
  return view.signals.reduce((max, signal) => (signal.stamp > max ? signal.stamp : max), '')
}

export function useSeen(views: TopicView[], selected: string | null) {
  const [seen, setSeen] = useState(read)

  useEffect(() => {
    if (views.length === 0 || Object.keys(seen).length > 0) return
    const now = new Date().toISOString()
    const all = Object.fromEntries(views.map(view => [view.topic.id, now]))
    setSeen(all)
    write(all)
  }, [views.length])

  useEffect(() => {
    if (!selected) return
    setSeen(current => {
      const next = { ...current, [selected]: new Date().toISOString() }
      write(next)
      return next
    })
  }, [selected])

  return useCallback(
    (view: TopicView) => {
      const stamp = latest(view)
      const last = seen[view.topic.id]
      return Boolean(stamp) && Boolean(Object.keys(seen).length) && (!last || stamp > last)
    },
    [seen],
  )
}
