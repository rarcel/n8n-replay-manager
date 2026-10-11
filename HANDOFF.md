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

Mise à jour : sélection, pagination, confirmation globale, envoi séquentiel, progression, arrêt entre POST et résultats individuels sont implémentés. Le modèle Traefik statique est préparé dans compose.traefik.yaml et deploy/TRAEFIK.md, sans déploiement. Restent la comparaison de priorité/middlewares/TLSOptions avec le POC et la validation Docker/Traefik/contrats réels sur instance autorisée. Les autres types de déclencheurs restent à étudier séparément. Ne pas envoyer de lot réel sans demande applicable.

Préparer la sélection bulk des exécutions d'un même workflow : pagination selon le contrat réel de l'API, sélection explicite, vérification individuelle et récapitulatif avant confirmation globale. Rejeux séquentiels, progression et résultat individuel, arrêt entre deux envois, protection contre doublons. Définir la politique en cas d'erreur. Ne pas lancer un lot réel sans demande applicable. Le bulk n'est pas implémenté à la migration.

## État local

Traefik : Dockerfile statique séparé, nginx sans proxy n8n, Compose indépendant avec réseau externe et labels limités au chemin du manager ; overlay ACME optionnel. Valeurs fournies : n8n.rarcel.net, réseau rproxy, entrypoint websecure ; conserver TLS Vault existant sans overlay ACME. Priorité 1000 à vérifier contre le router du POC. Ne pas combiner avec le Compose sandbox. Pas de Docker disponible ici, aucune validation de déploiement revendiquée.

Lot exécutable après compatibilité intégrale et confirmation globale : réutilisation du manager individuel pour chaque revalidation/lock/marqueur/POST, aucune approbation brute persistée, arrêt au premier refus ou ambiguïté. 41 tests factices passent ; Chrome a reçu exactement deux POST simulés puis reload a bloqué un doublon. Pas de rejeu réel. Les anciennes notes de préparation ci-dessous sont historiques.

Extension aux sorties JSON enregistrées de Webhook, Schedule Trigger et Manual Trigger. Découverte des workflows accessibles activée, avec détection d'un seul déclencheur exécuté compatible ; les workflows explicitement configurés gardent leur nom de déclencheur. Chat/formulaires/sous-workflows/autres types exclus. 36 tests factices passent. Aucun test réel des nouveaux types.

Liste d'exécutions via GET /rest/executions : filter workflowId/status/startedAfter/startedBefore, limit=50 et cursor opaque, contrat vérifié au tag 2.42.4. Cases explicites, sélection jusqu'à 50 conservée entre pages ; changements de filtres/workflow et erreurs de pagination/session invalident les choix. 34 tests factices passent ; parcours Chrome factice et rendu mobile vérifiés. `scripts/preview-fixtures.mjs` ne relaie rien et refuse toutes les écritures. Les notes de migration ci-dessous décrivent les étapes précédentes ; la pagination n'est plus en attente.

Sélecteur de workflows accessible ajouté avec noms et IDs, pagination take/skip et scopes n8n. Seuls les workflows configurés, non archivés et avec droits read/execute sont sélectionnables. 29 tests factices passent ; aucun changement de configuration de rejeu.

Préparation bulk ajoutée : saisie explicite de 1 à 50 IDs du même workflow, refus des doublons, vérification séquentielle individuelle et récapitulatif de métadonnées, sans approbation conservée ni POST bulk. 26 tests factices passent. La pagination attend la vérification du contrat détaillé de liste n8n 2.42.4 (sources détaillées indisponibles pendant cette itération). Confirmation globale, envoi séquentiel, arrêt et suivi individuel restent à implémenter. Politique future : arrêt au premier refus ou envoi ambigu, sans retry automatique ; voir README. Panneau non testé visuellement ni sur instance réelle.

Exécuter node scripts/validate.mjs depuis la racine : 23 tests à la migration. Docker et Traefik réels non testés ici. Captures précédentes illustrant le thème, pas le dernier libellé de confirmation.

Modifier directement ce dépôt, consulter les différences et produire des commits explicites. Ne plus échanger de ZIP pour les itérations normales. Aucun remote configuré et aucun secret intégré. Ne pas pousser, publier, déployer ou rejouer réellement sans demande applicable.
