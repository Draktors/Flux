# Flux

Poste de pilotage du flux tiré, pour macOS. Flux regarde tes PR GitHub, les tickets de ton outil de gestion de projet (Jira ou Linear) et ton agenda (Outlook / Teams, Google ou iCloud), et te montre une seule chose : ce qui t'attend maintenant, dans l'ordre où le traiter.

Chaque sujet est une note Markdown dans ton vault (Obsidian ou autre). Depuis un sujet, Flux ouvre un thread Claude Code dans Claude Desktop, avec un brief du contexte, et suit son état jusqu'à ce qu'il revienne vers toi.

## Ce que fait Flux

- **File** : les sujets où la balle est dans ton camp, classés par urgence (review oubliée, retours à traiter, review demandée, question, livraison…).
- **Threads** : un clic lance une session Claude Code dans Claude Desktop sur le bon dépôt et la bonne branche ; Flux la retrouve et affiche si elle travaille ou t'attend.
- **Notes** : chaque sujet porte une note en Markdown, rendue dans l'app et modifiable au clic.
- **Daily** : un récap généré chaque matin : ce que tu as fait la veille (commits, travail en cours, réunions et ce qui s'y est dit via Granola) et ce qui t'attend aujourd'hui.
- **Réunions** : Flux se tait pendant tes réunions et affiche la suivante.

## Prérequis

- macOS sur Apple Silicon, Node 20+ et pnpm
- Les outils en ligne de commande Xcode (`xcode-select --install`), pour compiler le petit module natif qui lit l’autorisation des notifications
- [GitHub CLI](https://cli.github.com) connectée à ton hôte GitHub (`gh auth login`)
- [Claude Code](https://claude.com/claude-code) et Claude Desktop
- Selon ton outil de gestion de projet : un jeton API Jira ou une clef API Linear, et l'adresse iCal secrète de ton agenda (facultatifs)

## Installer

```sh
pnpm install
pnpm install-app   # empaquette et copie Flux.app dans /Applications
```

Au premier lancement, un accueil vérifie GitHub, te demande quels outils de gestion de projet tu utilises (Jira, Linear ; Trello et Notion arrivent), puis enregistre leurs clefs et le lien iCal de ton agenda (Outlook / Teams, Google Agenda ou iCloud), une à une. Les Réglages permettent ensuite d'ajouter ou de retirer un outil ou l'agenda. Les clefs sont chiffrées avec le trousseau macOS et restent dans `~/.flux`.

## Configurer

Tout ce qui dépend de toi ou de ton entreprise vit dans `~/.flux/config.json`, jamais dans le dépôt. Chaque clef est facultative :

```json
{
  "ownerName": "Alex",
  "github": { "host": "github.com", "owner": "acme", "bots": ["review-bot"] },
  "linear": { "teams": ["APP", "WEB"] },
  "jira": { "site": "https://acme.atlassian.net" },
  "workspaces": [
    { "id": "web", "label": "Site e-commerce", "short": "WEB", "jiraProjects": ["WEB"], "github": { "owner": "acme", "repos": ["site", "site-api"] } },
    { "id": "app", "label": "Application mobile", "short": "APP", "jiraProjects": ["APP"], "github": { "owner": "acme", "repos": ["app"] } }
  ],
  "paths": {
    "vault": "~/Notes",
    "repos": "~/code",
    "dailyCommand": "~/.claude/skills/daily/SKILL.md"
  },
  "daily": { "allowedTools": [], "disallowedTools": [] },
  "prompts": { "ticket": "/execute-ticket {ref}" }
}
```

- `workspaces[].github.noReview` liste les dépôts où tes PR s'intègrent sans review (ex. `["app"]`) : une PR ouverte y passe en « Prêt à livrer » au lieu d'attendre une relecture.
- `github.owner` limite la file aux dépôts d'une organisation ; vide, Flux prend toutes les PR qui t'impliquent.
- `github.bots` liste les logins dont les commentaires ne comptent pas comme un humain qui t'attend.
- `linear.teams` liste les clefs d'équipe reconnues dans les titres et les branches ; vide, toute clef `ABC-123` en majuscules compte.
- `jira.site` est le site Atlassian par défaut ; le site saisi dans les Réglages a la priorité, avec l'e-mail et le jeton API.
- **Espaces** : une fois Jira ou Linear connecté, la page Espaces des Réglages (ouverte aussi par le bouton au bout du sélecteur, et à l'accueil) liste tes projets Jira et tes équipes Linear. Les changements s'enregistrent d'eux-mêmes, et l'ordre glissé est celui du sélecteur. Chaque projet coché devient un espace, avec ses dépôts GitHub (et ceux qui s'intègrent sans review) : un sélecteur apparaît à côté du logo dès qu'il y en a deux, et Flux ne montre alors que les tickets, les PR et le daily de l'espace choisi. Les notes libres restent visibles partout.
- `workspaces` (config.json) sert tant que tu n'as rien coché dans l'app, et permet de regrouper plusieurs projets dans un même espace. Il liste les produits sur lesquels tu alternes. Avec deux espaces ou plus, un sélecteur apparaît à côté du logo : Flux ne lit alors que les tickets Jira de `jiraProjects` et les PR de `github.repos` (ou de toute l'organisation `github.owner` sans liste). Les sujets dont tous les liens appartiennent à l'autre espace sont masqués, les notes libres restent visibles partout. Sans `workspaces`, Flux montre tout.
- `workspaces[].keywords` ajoute des mots qui désignent un produit dans le titre ou le résumé d'un call Granola (en plus de son nom, de son nom court et de ses projets Jira).
- `rotation` décrit ton alternance : `{ "start": "2026-11-09", "weeks": 2, "order": ["app", "web"] }` veut dire deux semaines sur APP à partir de ce lundi, puis deux sur WEB. Quand rien dans un call ne nomme le produit, Flux prend celui de la semaine et le marque « À vérifier ».
- `paths.vault` contient les sujets (`flux/`) et les daily (`daily/`) ; `paths.repos` contient les clones où s'ouvrent les threads, et où le daily relève tes commits et ton travail non commité depuis la veille ouvrée.
- `paths.dailyCommand` est le prompt du daily : le skill `~/.claude/skills/daily/SKILL.md` (aussi lançable avec `/daily` dans Claude Code), ou à défaut `~/.claude/commands/daily.md`.
- `daily.allowedTools` liste les outils MCP en lecture que le daily peut appeler, par exemple `["mcp__granola"]` pour lire les notes et transcripts Granola des réunions de la veille.
- `prompts` remplace le prompt d'une action (`take-comments`, `review`, `ticket`, `diagnostic`, `cadrage`…), avec `{url}` et `{ref}`.

## Développer

```sh
pnpm dev         # app en mode développement
pnpm test        # tests (n'utilisent jamais ta configuration locale)
pnpm typecheck
```
