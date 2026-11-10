import { describe, expect, it } from 'vitest'

import { brandOf } from '../src/renderer/src/Brand'

describe('brandOf', () => {
  it('recognises where a link leads', () => {
    expect(brandOf('https://github.com/acme/web/pull/12')).toBe('github')
    expect(brandOf('https://acme.ghe.com/acme/web/pull/12')).toBe('github')
    expect(brandOf('https://linear.app/acme/issue/APP-1')).toBe('linear')
    expect(brandOf('claude://resume?session=abc')).toBe('claude')
    expect(brandOf('obsidian://open?vault=notes')).toBe('obsidian')
    expect(brandOf('https://calendar.google.com/calendar/event?eid=1')).toBe('calendar')
    expect(brandOf('https://acme.sentry.io/issues/1')).toBe('sentry')
  })

  it('falls back for unknown or broken links', () => {
    expect(brandOf('https://example.com')).toBeNull()
    expect(brandOf('pas une url')).toBeNull()
    expect(brandOf(undefined)).toBeNull()
  })
})
