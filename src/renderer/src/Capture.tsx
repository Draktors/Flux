import { useEffect, useRef, useState } from 'react'

export function Capture() {
  const [text, setText] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => field.current?.focus(), [])

  return (
    <div className="capture">
      <textarea
        ref={field}
        value={text}
        placeholder="Une note, une idée, un sujet à tirer"
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') void window.flux.closeCapture()
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void window.flux.createNote(text)
          }
        }}
      />
      <p>Entrée pour garder, Maj+Entrée pour une ligne, Échap pour annuler</p>
    </div>
  )
}
