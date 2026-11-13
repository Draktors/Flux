import { describe, expect, it } from 'vitest'
import { nextProfiles, parseProfiles, profileDir } from '../src/main/profile'

describe('profils', () => {
  it('garde Pro dans ~/.flux et range Perso à part', () => {
    expect(profileDir('/Users/me/.flux', 'pro')).toBe('/Users/me/.flux')
    expect(profileDir('/Users/me/.flux', 'perso')).toBe('/Users/me/.flux/profiles/perso')
  })

  it('part de Pro seul quand le fichier manque ou est illisible', () => {
    expect(parseProfiles(null)).toEqual({ active: 'pro', perso: false })
    expect(parseProfiles('oups')).toEqual({ active: 'pro', perso: false })
    expect(parseProfiles({ active: 'perso' })).toEqual({ active: 'pro', perso: false })
    expect(parseProfiles({ active: 'perso', perso: true })).toEqual({ active: 'perso', perso: true })
  })

  it('active Perso en y passant et revient sur Pro quand on le masque', () => {
    const pro = { active: 'pro', perso: false } as const
    expect(nextProfiles(pro, { active: 'perso' })).toEqual({ active: 'perso', perso: true })
    expect(nextProfiles(pro, { perso: true })).toEqual({ active: 'pro', perso: true })
    expect(nextProfiles({ active: 'perso', perso: true }, { perso: false })).toEqual({
      active: 'pro',
      perso: false,
    })
    expect(nextProfiles({ active: 'perso', perso: true }, { active: 'pro' })).toEqual({
      active: 'pro',
      perso: true,
    })
  })
})
