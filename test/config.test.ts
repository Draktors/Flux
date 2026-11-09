import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '../src/main/config'
import { promptFor } from '../src/main/threads/actions'

describe('configuration locale', () => {
  it('garde les valeurs neutres quand rien n’est configuré', () => {
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it('fusionne une configuration partielle et développe ~', () => {
    const config = mergeConfig({
      github: { host: 'git.example.com' },
      paths: { vault: '~/Notes' },
    })
    expect(config.github).toEqual({ host: 'git.example.com', owner: '', bots: [] })
    expect(config.paths.vault).toBe(join(homedir(), 'Notes'))
    expect(config.paths.repos).toBe(DEFAULT_CONFIG.paths.repos)
  })
})

describe('prompts des actions', () => {
  it('remplit le prompt par défaut avec le lien', () => {
    expect(promptFor('review', 'web#12', 'https://x/12', {})).toContain('https://x/12')
  })

  it('prend la commande configurée à la place du texte par défaut', () => {
    const overrides = { ticket: '/execute-ticket {ref}' }
    expect(promptFor('ticket', 'APP-7', 'https://t/APP-7', overrides)).toBe('/execute-ticket APP-7')
  })

  it('ne propose pas de prompt pour reprendre ou livrer', () => {
    expect(promptFor('resume', 'web#12', '', {})).toBeUndefined()
    expect(promptFor('ship', 'web#12', '', {})).toBeUndefined()
  })
})
