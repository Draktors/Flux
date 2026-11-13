import { CircleAlert, CircleCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

export interface ToastMessage {
  id: number
  text: string
  tone: 'ok' | 'error'
}

// Long enough to read a ref that a flux:// link no longer finds
const VISIBLE_MS = 4000
const LEAVE_MS = 180

export function Toast({ toast, onDone }: { toast: ToastMessage; onDone(): void }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    setLeaving(false)
    const leave = setTimeout(() => setLeaving(true), VISIBLE_MS)
    const done = setTimeout(onDone, VISIBLE_MS + LEAVE_MS)
    return () => {
      clearTimeout(leave)
      clearTimeout(done)
    }
  }, [toast.id])

  const Icon = toast.tone === 'ok' ? CircleCheck : CircleAlert
  return (
    <div
      key={toast.id}
      className={`toast glass-dark ${toast.tone}`}
      data-state={leaving ? 'closed' : 'open'}
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <Icon size={17} aria-hidden="true" />
      {toast.text}
    </div>
  )
}
