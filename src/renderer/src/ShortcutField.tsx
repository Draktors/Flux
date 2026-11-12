import { Keyboard, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { acceleratorFrom, shortcutLabel } from '../../shared/shortcuts'

type Layout = (code: string) => string | undefined

// Chromium knows which character the keyboard prints on each key (A where QWERTY has Q)
function useLayout(): Layout | undefined {
  const [layout, setLayout] = useState<Layout>()
  useEffect(() => {
    const keyboard = (navigator as { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard
    keyboard
      ?.getLayoutMap()
      .then(map => setLayout(() => (code: string) => map.get(code)))
      .catch(() => undefined)
  }, [])
  return layout
}

// Click, press the keys, done: Escape keeps the old one, ⌫ removes it
export function ShortcutField({ value, onChange }: { value: string; onChange(value: string): void }) {
  const input = useRef<HTMLInputElement>(null)
  const layout = useLayout()
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Closing the panel mid-recording gives the shortcut back
  useEffect(() => {
    if (!recording) return
    void window.flux.recordCaptureShortcut(true)
    return () => void window.flux.recordCaptureShortcut(false)
  }, [recording])

  const onKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return
    event.preventDefault()
    // Escape must not close the whole panel
    event.stopPropagation()
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    if (event.key === 'Escape' && plain) return input.current?.blur()
    if ((event.key === 'Backspace' || event.key === 'Delete') && plain) {
      onChange('')
      return input.current?.blur()
    }
    const accelerator = acceleratorFrom(event)
    if (!accelerator) {
      if (!['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) setError('Ajoute ⌘, ⌃ ou ⌥ à la touche')
      return
    }
    if (!(await window.flux.checkShortcut(accelerator))) {
      setError(`${shortcutLabel(accelerator, layout)} est déjà pris par une autre app`)
      return
    }
    onChange(accelerator)
    input.current?.blur()
  }

  return (
    <>
      <span className="input-shell shortcut-field">
        <Keyboard size={16} aria-hidden="true" className="input-icon" />
        <input
          ref={input}
          readOnly
          value={recording ? '' : shortcutLabel(value, layout)}
          placeholder={recording ? 'Appuie sur les touches…' : 'Aucun'}
          onFocus={() => {
            setError(null)
            setRecording(true)
          }}
          onBlur={() => setRecording(false)}
          onKeyDown={event => void onKeyDown(event)}
          aria-label="Raccourci nouvelle note"
        />
        {value && !recording && (
          <button type="button" className="shortcut-clear" onClick={() => onChange('')} aria-label="Retirer le raccourci">
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </span>
      {error && <small className="shortcut-error">{error}</small>}
    </>
  )
}
