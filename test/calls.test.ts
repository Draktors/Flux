import { describe, expect, it } from 'vitest'
import type { Workspace } from '../src/main/config'
import { classifyByRules, rotationWorkspace, typeFromTitle, workspaceFromText } from '../src/main/calls/classify'
import { needsRefresh } from '../src/main/calls/service'
import { parseMeetingList, parseMeetings } from '../src/main/sources/granola'

const WORKSPACES: Workspace[] = [
  { id: 'pp', label: 'PanneauPocket', short: 'PP', jiraProjects: ['DEVPP'], keywords: ['pp+'], github: {} },
  { id: 'cc', label: 'Communicity', short: 'CC', jiraProjects: ['CCM'], keywords: ['citopia'], github: {} },
]
// Two weeks of CC from Monday 9 November, then two of PP
const ROTATION = { start: '2026-11-09', weeks: 2, order: ['cc', 'pp'] }

describe('type d’appel', () => {
  it('lit le type dans le titre', () => {
    expect(typeFromTitle('PP Daily 02/11 - Grafana access')).toBe('daily')
    expect(typeFromTitle('PP - Sprint Review & Sprint Retro')).toBe('review-retro')
    expect(typeFromTitle('Rétrospective sprint : automatisation et évolution IA')).toBe('retro')
    expect(typeFromTitle('Sprint planning 47')).toBe('planning')
    expect(typeFromTitle('Point IA : agents et MCP')).toBe('ai')
    expect(typeFromTitle('Affinage backlog')).toBe('refinement')
    expect(typeFromTitle('Téléchargement de fichier')).toBeNull()
  })
})

describe('produit', () => {
  it('reconnaît un produit nommé, pas deux', () => {
    expect(workspaceFromText('PP+ upgrade strategy', WORKSPACES)).toBe('pp')
    expect(workspaceFromText('Démo Communicity', WORKSPACES)).toBe('cc')
    expect(workspaceFromText('Point CCM-120', WORKSPACES)).toBe('cc')
    expect(workspaceFromText('Synchro PP et CC', WORKSPACES)).toBeNull()
    expect(workspaceFromText('Happy hour', WORKSPACES)).toBeNull()
  })

  it('suit l’alternance de deux semaines', () => {
    expect(rotationWorkspace(ROTATION, new Date(2026, 10, 9, 10))).toBe('cc')
    expect(rotationWorkspace(ROTATION, new Date(2026, 10, 20, 17))).toBe('cc')
    expect(rotationWorkspace(ROTATION, new Date(2026, 10, 23, 9))).toBe('pp')
    expect(rotationWorkspace(ROTATION, new Date(2026, 11, 7, 9))).toBe('cc')
    expect(rotationWorkspace(ROTATION, new Date(2026, 10, 3, 16))).toBe('pp')
  })

  it('ne se fie pas à un nom cité dans le résumé', () => {
    const rules = classifyByRules(
      { title: 'Rétrospective sprint', summary: 'Fabien (Citopia) a un projet GitHub', at: '2026-11-03T16:00:00+01:00' },
      { workspaces: WORKSPACES, rotation: ROTATION },
    )
    expect(rules.workspace).toEqual({ value: 'pp', source: 'rotation' })
  })

  it('retombe sur l’alternance quand rien ne nomme le produit', () => {
    const rules = classifyByRules(
      { title: 'Téléchargement de fichier', summary: null, at: '2026-11-10T10:00:00+01:00' },
      { workspaces: WORKSPACES, rotation: ROTATION },
    )
    expect(rules.type).toEqual({ value: 'other', source: 'rotation' })
    expect(rules.workspace).toEqual({ value: 'cc', source: 'rotation' })
  })
})

describe('réponses Granola', () => {
  const LIST = `<meetings_data from="Nov 2, 2026" to="Nov 3, 2026" count="2">
<meeting id="aaa" title="Daily &amp; météo" date="Nov 3" meeting_at="2026-11-03T09:00:00+01:00" url="https://notes.granola.ai/d/aaa">
  <known_participants>
  Alex Martin (note creator) (alex@example.com)
  Sam Lee (sam@example.com)
  </known_participants>
  <folders />
  <summary>
# Points
- Livraison vendredi
</summary>
</meeting>
<meeting id="bbb" title="Rétro" meeting_at="2026-11-02T16:00:00+01:00" updated_at="2026-11-02T17:00:00+01:00">
</meeting>
</meetings_data>`

  it('liste les appels avec leurs attributs', () => {
    const { meetings, cursor } = parseMeetingList(LIST)
    expect(cursor).toBeNull()
    expect(meetings[0]).toMatchObject({ id: 'aaa', title: 'Daily & météo', at: '2026-11-03T09:00:00+01:00' })
    expect(meetings[1]).toMatchObject({ id: 'bbb', url: 'https://notes.granola.ai/d/bbb', updatedAt: '2026-11-02T17:00:00+01:00' })
  })

  it('lit les participants et le résumé', () => {
    const [first, second] = parseMeetings(LIST)
    expect(first.participants).toEqual(['Alex Martin', 'Sam Lee'])
    expect(first.summary).toBe('# Points\n- Livraison vendredi')
    expect(second.summary).toBeNull()
  })
})

describe('relecture des notes Granola', () => {
  const meeting = { id: 'aaa', title: 'Rétro', at: '2026-11-10T15:10:00+01:00', url: '', updatedAt: null }
  const note = { ...meeting, participants: [], summary: '# Points', updatedAt: '2026-11-10T16:00:00+01:00' }

  it('relit une note lue avant que Granola ait écrit son résumé', () => {
    expect(needsRefresh(meeting, { ...note, title: 'New note', summary: null })).toBe(true)
  })

  it('laisse une note complète quand la liste ne dit rien de neuf', () => {
    expect(needsRefresh(meeting, note)).toBe(false)
    expect(needsRefresh({ ...meeting, updatedAt: note.updatedAt }, note)).toBe(false)
  })

  it('relit une note modifiée ou inconnue', () => {
    expect(needsRefresh({ ...meeting, updatedAt: '2026-11-12T09:00:00+01:00' }, note)).toBe(true)
    expect(needsRefresh(meeting, undefined)).toBe(true)
  })
})
