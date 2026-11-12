// The generic daily skill Flux offers to write: nothing in it belongs to a person or a company
export const DAILY_TEMPLATE = `Daily de Flux : prépare le stand-up et surveille la santé de la prod, en lecture seule. Lancé chaque matin par Flux, il rend un JSON. Lancé à la main, il affiche le même contenu en texte.

## Ce que Flux attend

Flux affiche lui-même ce qui a été fait la veille, les bloquants et la file. Ce skill fait quatre choses :

1. **Intentions** : choisir les 3 sujets du jour parmi les candidats fournis, dans l'ordre où les traiter. D'abord ce qui débloque quelqu'un, puis ce qui attend depuis longtemps.
2. **Titres courts** : reformuler chaque titre en 8 mots au plus, sans les refs.
3. **Pour avancer** : pour chaque bloquant, l'action qui le ferait avancer, en une phrase.
4. **Santé prod** : une ligne par source décrite plus bas, avec le signal phare en quelques mots. Une source qui suit plusieurs chiffres les liste dans \`items\`.

## Sources de santé prod

Aucune source n'est décrite pour l'instant : la santé prod est vide et Flux affiche RAS.

Pour en ajouter une, décris ici son nom, l'outil MCP à appeler, ce qui compte comme alerte, signal faible ou bonne nouvelle, et le lien vers la vue. L'outil doit figurer dans \`daily.allowedTools\` de \`~/.flux/config.json\`. Par exemple :

- **Erreurs** : nouvelles issues et régressions des dernières 48 h. Alerte si une issue touche beaucoup d'utilisateurs, signal faible si elle monte.
- **Adoption** : usage des fonctionnalités livrées ces 14 derniers jours. Bonne nouvelle si l'usage monte.

## Règles

- **Lecture seule** : ne modifie rien, nulle part.
- Une source injoignable a le niveau \`unavailable\`.
- Sortie en français, factuelle, sans mention d'IA.

## Lancé à la main

Sans Flux, lis \`~/.flux/snapshot.json\` et les journaux \`~/.flux/wrapup/<date>.json\` de la veille ouvrée et du jour. Affiche ensuite en texte : Hier, Aujourd'hui (3 intentions), Bloquants, Santé prod, et le compte de la file par rang.
`
