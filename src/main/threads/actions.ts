import type { ActionKind, Item, ProposedAction, Signal, Topic } from '../../shared/types'
import { CONFIG } from '../config'

const LABELS: Record<ActionKind, string> = {
  'submit-review': 'Relire et soumettre',
  'take-comments': 'Prendre les retours',
  review: 'Lancer la review',
  're-review': 'Reprendre la review',
  question: 'Préparer la réponse',
  ship: 'Ouvrir pour livrer',
  'fix-pr': 'Remettre la PR au clair',
  ticket: 'Exécuter le ticket',
  diagnostic: 'Diagnostiquer',
  cadrage: 'Cadrer',
  resume: 'Y aller',
  free: 'Lancer un thread',
}

const DEFAULT_PROMPTS: Partial<Record<ActionKind, string>> = {
  'submit-review':
    "J'ai une review en attente sur {url}. Relis ses commentaires avec moi, puis soumets-la quand je valide.",
  'take-comments':
    'Traite les retours de review non résolus de {url} : pour chacun, propose corriger, expliquer ou refuser, et attends ma validation avant de modifier le code ou de répondre.',
  review:
    'Aide-moi à review {url}. Ne poste rien sans ma validation, ajoute les commentaires dans une review en attente.',
  're-review':
    "Reprends ma review de {url} : qu'est-ce qui a changé depuis, et à quelles réponses dois-je réagir ?",
  question: "Aide-moi à débloquer {url}. Résume ce qu'on attend de moi et propose une réponse.",
  'fix-pr': "Regarde l'état de {url} et dis-moi ce qu'il faut pour la faire avancer.",
  ticket: 'Prends en main le ticket {ref} ({url}) : lis-le, explore le code concerné et propose un plan avant de coder.',
  diagnostic: "Diagnostique le bug {ref} ({url}) : mesure l'impact, trouve la cause et propose un correctif.",
  cadrage: 'Aide-moi à cadrer {ref} ({url}) : besoin, périmètre, découpage et risques.',
  free: 'Prends connaissance de ce sujet et dis-moi par où commencer.',
}

export function promptFor(
  kind: ActionKind,
  ref: string,
  url: string,
  overrides: Partial<Record<ActionKind, string>> = CONFIG.prompts,
): string | undefined {
  if (kind === 'ship' || kind === 'resume') return undefined
  const template = overrides[kind] ?? DEFAULT_PROMPTS[kind]
  return template?.replaceAll('{url}', url).replaceAll('{ref}', ref)
}

export function repoFromRef(ref: string): string | undefined {
  return ref.includes('#') ? ref.split('#')[0] : undefined
}

export function proposedActions(topic: Topic, items: Item[], signals: Signal[]): ProposedAction[] {
  const actions: ProposedAction[] = []
  const seen = new Set<ActionKind>()
  for (const current of signals) {
    if (seen.has(current.action)) continue
    seen.add(current.action)
    const item = items.find(entry => current.id.startsWith(`${entry.ref}:`))
    const ref = item?.ref ?? topic.id
    const url = item?.url ?? ''
    actions.push({
      kind: current.action,
      label: LABELS[current.action],
      url,
      prompt: promptFor(current.action, ref, url),
    })
  }
  if (!seen.has('free') && actions.every(action => action.kind !== 'resume')) {
    actions.push({
      kind: 'free',
      label: LABELS.free,
      url: items[0]?.url ?? '',
      prompt: promptFor('free', topic.id, ''),
    })
  }
  return actions
}
