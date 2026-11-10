# Flux

Poste de pilotage du flux tiré, pour macOS. Flux regarde tes PR GitHub, tes tickets Linear et ton agenda, et te montre une seule chose : ce qui t'attend maintenant, dans l'ordre où le traiter.

Chaque sujet est une note Markdown dans ton vault (Obsidian ou autre). Depuis un sujet, Flux ouvre un thread Claude Code dans Claude Desktop, avec un brief du contexte, et suit son état jusqu'à ce qu'il revienne vers toi.

## Ce que fait Flux

- **File** : les sujets où la balle est dans ton camp, classés par urgence (review oubliée, retours à traiter, review demandée, question, livraison…).
- **Threads** : un clic lance une session Claude Code dans Claude Desktop sur le bon dépôt et la bonne branche ; Flux la retrouve et affiche si elle travaille ou t'attend.
- **Notes** : chaque sujet porte une note en Markdown, rendue dans l'app et modifiable au clic.
- **Daily** : un récap du jour généré chaque matin à partir de l'état de la file.
- **Réunions** : Flux se tait pendant tes réunions et affiche la suivante.

## Prérequis

- macOS sur Apple Silicon, Node 20+ et pnpm
- Les outils en ligne de commande Xcode (`xcode-select --install`), pour compiler le petit module natif qui lit l’autorisation des notifications
- [GitHub CLI](https://cli.github.com) connectée à ton hôte GitHub (`gh auth login`)
- [Claude Code](https://claude.com/claude-code) et Claude Desktop
- Une clef API personnelle Linear et l'adresse iCal secrète de ton agenda (facultatives)

## Installer

```sh
pnpm install
pnpm install-app   # empaquette et copie Flux.app dans /Applications
```

Au premier lancement, un accueil vérifie GitHub puis enregistre la clef Linear et l'adresse de l'agenda, une à une. Les clefs sont chiffrées avec le trousseau macOS et restent dans `~/.flux`.

## Configurer

Tout ce qui dépend de toi ou de ton entreprise vit dans `~/.flux/config.json`, jamais dans le dépôt. Chaque clef est facultative :

```json
{
  "ownerName": "Alex",
  "github": { "host": "github.com", "owner": "acme", "bots": ["review-bot"] },
  "linear": { "teams": ["APP", "WEB"] },
  "paths": {
    "vault": "~/Notes",
    "repos": "~/code",
    "dailyCommand": "~/.claude/commands/daily.md"
  },
  "daily": { "allowedTools": [], "disallowedTools": [] },
  "prompts": { "ticket": "/execute-ticket {ref}" }
}
```

- `github.owner` limite la file aux dépôts d'une organisation ; vide, Flux prend toutes les PR qui t'impliquent.
- `github.bots` liste les logins dont les commentaires ne comptent pas comme un humain qui t'attend.
- `linear.teams` liste les clefs d'équipe reconnues dans les titres et les branches ; vide, toute clef `ABC-123` en majuscules compte.
- `paths.vault` contient les sujets (`flux/`) et les daily (`daily/`) ; `paths.repos` contient les clones où s'ouvrent les threads.
- `prompts` remplace le prompt d'une action (`take-comments`, `review`, `ticket`, `diagnostic`, `cadrage`…), avec `{url}` et `{ref}`.

## Développer

```sh
pnpm dev         # app en mode développement
pnpm test        # tests (n'utilisent jamais ta configuration locale)
pnpm typecheck
```
