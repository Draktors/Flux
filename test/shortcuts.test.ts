import { describe, expect, it } from 'vitest'
import { acceleratorFrom, shortcutLabel } from '../src/shared/shortcuts'

const press = (code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('raccourci nouvelle note', () => {
  it('lit une combinaison par la position des touches', () => {
    expect(acceleratorFrom(press('KeyN', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+N')
    expect(acceleratorFrom(press('Digit2', { metaKey: true, shiftKey: true }))).toBe('Command+Shift+2')
    expect(acceleratorFrom(press('Space', { altKey: true }))).toBe('Alt+Space')
    expect(acceleratorFrom(press('F5'))).toBe('F5')
  })

  it('attend une vraie touche et refuse ce qui volerait la frappe', () => {
    expect(acceleratorFrom(press('AltLeft', { altKey: true }))).toBeNull()
    expect(acceleratorFrom(press('KeyN'))).toBeNull()
    expect(acceleratorFrom(press('KeyN', { shiftKey: true }))).toBeNull()
  })

  it('affiche les symboles du Mac et la lettre du clavier', () => {
    expect(shortcutLabel('Control+Alt+N')).toBe('⌃⌥N')
    expect(shortcutLabel('Command+Shift+Space')).toBe('⇧⌘Espace')
    // AZERTY prints A on the key QWERTY calls Q
    expect(shortcutLabel('Control+Q', code => (code === 'KeyQ' ? 'a' : undefined))).toBe('⌃A')
    expect(shortcutLabel('')).toBe('')
  })
})
