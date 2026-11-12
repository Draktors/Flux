import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// macOS waits about a second before its own tooltips: Flux answers almost at once,
// and right away while you sweep from one button to the next
const SHOW_MS = 220
const WARM_MS = 500
const GAP = 8
const MARGIN = 8

interface Tip {
  text: string
  anchor: DOMRect
}

// Takes the text out of `title` so the slow native tooltip never shows; screen readers
// keep it through aria-description
function tipOf(element: Element): string {
  const title = element.getAttribute('title')
  if (title !== null) {
    element.removeAttribute('title')
    element.setAttribute('data-tip', title)
    if (title && element.getAttribute('aria-label') !== title) element.setAttribute('aria-description', title)
  }
  return element.getAttribute('data-tip') ?? ''
}

// One layer for the whole window: any element with a title gets Flux's tooltip
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const bubble = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current: Element | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let hiddenAt = 0

    const hide = () => {
      clearTimeout(timer)
      if (current) hiddenAt = Date.now()
      current = null
      setTip(null)
    }

    const over = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest?.('[title], [data-tip]') ?? null
      if (element === current) return
      hide()
      if (!element) return
      const text = tipOf(element)
      if (!text) return
      current = element
      const warm = Date.now() - hiddenAt < WARM_MS
      timer = setTimeout(
        () => {
          if (current === element && element.isConnected) setTip({ text, anchor: element.getBoundingClientRect() })
        },
        warm ? 0 : SHOW_MS,
      )
    }

    const out = (event: PointerEvent) => {
      if (current && !current.contains(event.relatedTarget as Node | null)) hide()
    }

    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    // A click, a key or a scroll moves things: the tooltip would point at the wrong place
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Under the element, centred, flipped above when the window ends, kept inside it
  useLayoutEffect(() => {
    if (!tip || !bubble.current) return setPlace(null)
    const { width, height } = bubble.current.getBoundingClientRect()
    const below = tip.anchor.bottom + GAP + height <= window.innerHeight - MARGIN
    const centre = tip.anchor.left + tip.anchor.width / 2
    setPlace({
      left: Math.min(Math.max(centre - width / 2, MARGIN), window.innerWidth - width - MARGIN),
      top: below ? tip.anchor.bottom + GAP : tip.anchor.top - GAP - height,
      below,
    })
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      className={`tooltip${place ? ' shown' : ''}${place && !place.below ? ' above' : ''}`}
      style={place ? { left: place.left, top: place.top } : undefined}
    >
      {tip.text}
    </div>,
    document.body,
  )
}
