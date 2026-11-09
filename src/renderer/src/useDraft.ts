import { useEffect, useRef, useState } from 'react'

export function useDraft(value: string, save: (next: string) => void) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<number | null>(null)
  const dirty = useRef(false)

  useEffect(() => {
    if (!dirty.current) setDraft(value)
  }, [value])

  const change = (next: string) => {
    dirty.current = true
    setDraft(next)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      dirty.current = false
      save(next)
    }, 600)
  }
  return [draft, change] as const
}
