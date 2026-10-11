# Reprise dans Codex

Le rejeu individuel et les effets attendus ont été confirmés par l'utilisateur sur son instance. Cette observation n'est pas un test automatisé de l'agent.

Lire AGENTS.md, README.md et VALIDATION.md avant modification. Le POC utilise les routes internes éditeur n8n 2.42.4, sans garantie de support officiel.

## Décisions à conserver

- Interface sous /replay-manager/, même origine exacte que l'éditeur et /rest/ ; rejeu uniquement navigateur.
- Session ambiante, permissions n8n serveur, aucun cookie exporté, clé API, compte technique ou image n8n modifiée.
- Données JSON du Webhook source rejouées dans le workflow ACTUEL et ses credentials actuels ; version historique absente/différente autorisée.
- Version actuelle obligatoire ; version, nodes, connections, settings et payload comparés entre aperçu et dernière lecture. Pas de précondition atomique côté serveur.
- Confirmation des effets, marqueur local avant POST, Web Locks, aucun retry automatique.
- Thème n8n conservé, Inter locale, préférence clair/sombre lue sans modification.
- Traefik cible de déploiement. Exemples nginx/Compose sandbox ; production Traefik reste à préparer.

## Prochaine évolution

Préparer la sélection bulk des exécutions d'un même workflow : pagination selon le contrat réel de l'API, sélection explicite, vérification individuelle et récapitulatif avant confirmation globale. Rejeux séquentiels, progression et résultat individuel, arrêt entre deux envois, protection contre doublons. Définir la politique en cas d'erreur. Ne pas lancer un lot réel sans demande applicable. Le bulk n'est pas implémenté à la migration.

## État local

Sélecteur de workflows accessible ajouté avec noms et IDs, pagination take/skip et scopes n8n. Seuls les workflows configurés, non archivés et avec droits read/execute sont sélectionnables. 29 tests factices passent ; aucun changement de configuration de rejeu.

Préparation bulk ajoutée : saisie explicite de 1 à 50 IDs du même workflow, refus des doublons, vérification séquentielle individuelle et récapitulatif de métadonnées, sans approbation conservée ni POST bulk. 26 tests factices passent. La pagination attend la vérification du contrat détaillé de liste n8n 2.42.4 (sources détaillées indisponibles pendant cette itération). Confirmation globale, envoi séquentiel, arrêt et suivi individuel restent à implémenter. Politique future : arrêt au premier refus ou envoi ambigu, sans retry automatique ; voir README. Panneau non testé visuellement ni sur instance réelle.

Exécuter node scripts/validate.mjs depuis la racine : 23 tests à la migration. Docker et Traefik réels non testés ici. Captures précédentes illustrant le thème, pas le dernier libellé de confirmation.

Modifier directement ce dépôt, consulter les différences et produire des commits explicites. Ne plus échanger de ZIP pour les itérations normales. Aucun remote configuré et aucun secret intégré. Ne pas pousser, publier, déployer ou rejouer réellement sans demande applicable.
