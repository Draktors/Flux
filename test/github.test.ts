import { describe, expect, it } from 'vitest'
import { parseAccounts, tokenArgs } from '../src/main/sources/github'

describe('comptes GitHub', () => {
  it('lit le compte actif de gh quand aucun compte n’est choisi', () => {
    expect(tokenArgs(null)).toEqual(['auth', 'token', '--hostname', 'github.com'])
  })

  it('demande le token du compte choisi sans changer le compte actif', () => {
    expect(tokenArgs('draktors')).toEqual([
      'auth',
      'token',
      '--hostname',
      'github.com',
      '--user',
      'draktors',
    ])
  })

  it('liste les comptes connectés, le compte actif en premier', () => {
    const json = JSON.stringify({
      hosts: {
        'github.com': [
          { login: 'perso', active: false, state: 'success' },
          { login: 'travail', active: true, state: 'success' },
          { login: 'expire', active: false, state: 'error' },
        ],
        'git.example.com': [{ login: 'ailleurs', active: true, state: 'success' }],
      },
    })
    expect(parseAccounts(json, 'github.com')).toEqual({
      logins: ['travail', 'perso'],
      active: 'travail',
    })
  })

  it('rend une liste vide pour un hôte sans compte', () => {
    expect(parseAccounts(JSON.stringify({ hosts: {} }), 'github.com')).toEqual({
      logins: [],
      active: null,
    })
  })
})
