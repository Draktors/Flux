// Turns key presses into Electron accelerators ("Control+Alt+N") and back into ⌃⌥N

export interface KeyPress {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

// Key positions Electron names differently from KeyboardEvent.code
const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}

const SYMBOLS: Record<string, string> = {
  Space: 'Espace',
  Return: '↩',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Home: '↖',
  End: '↘',
  PageUp: '⇞',
  PageDown: '⇟',
}

// The key is taken by its position, as macOS registers global shortcuts: what the
// layout prints on it is only for the label
function keyOf(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)?.[1]
  if (letter) return letter
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code)?.[1]
  if (digit) return digit
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  return NAMED[code] ?? null
}

// null while only modifiers are held, or for a press that would steal plain typing
export function acceleratorFrom(press: KeyPress): string | null {
  const key = keyOf(press.code)
  if (!key) return null
  const isFunctionKey = /^F\d+$/.test(key)
  if (!press.metaKey && !press.ctrlKey && !press.altKey && !isFunctionKey) return null
  return [
    press.metaKey && 'Command',
    press.ctrlKey && 'Control',
    press.altKey && 'Alt',
    press.shiftKey && 'Shift',
    key,
  ]
    .filter(Boolean)
    .join('+')
}

function codeOf(key: string): string | null {
  if (/^[A-Z]$/.test(key)) return `Key${key}`
  if (/^\d$/.test(key)) return `Digit${key}`
  return Object.entries(NAMED).find(([, name]) => name === key)?.[0] ?? null
}

// ⌃⌥⇧⌘ in Apple's order; layout gives the character the user's keyboard prints on that key
export function shortcutLabel(accelerator: string, layout?: (code: string) => string | undefined): string {
  if (!accelerator) return ''
  const parts = accelerator.split('+')
  // "+" itself would split into an empty last part
  const key = parts.at(-1) === '' ? '+' : (parts.at(-1) ?? '')
  const mods = new Set(parts.slice(0, -1).map(part => part.toLowerCase()))
  const has = (...names: string[]) => names.some(name => mods.has(name))
  const code = codeOf(key)
  const printed = code && /^(Key|Digit)/.test(code) ? layout?.(code)?.toUpperCase() : undefined
  return [
    has('control', 'ctrl') && '⌃',
    has('alt', 'option') && '⌥',
    has('shift') && '⇧',
    has('command', 'cmd', 'commandorcontrol', 'cmdorctrl', 'super', 'meta') && '⌘',
    printed ?? SYMBOLS[key] ?? key,
  ]
    .filter(Boolean)
    .join('')
}
