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

Choix Action à effectuer : Rejeu ou Retry natif avec définition actuelle (loadWorkflow:true). Retry réservé aux erreurs terminales finished=false avec pile compatible ; pins/binary/redaction/multiples runs/attentes/nodes incompatibles refusés. Simulation/confirmation/revalidation obligatoires, locks et marqueurs partagés entre modes, pas de retry automatique. Lot arrêté si retry répond autre chose que succès. 56 tests factices passent ; deux POST HTTP locaux simulés + contrôle provenance/résultat/doublons. Pas de validation sur n8n réel.

Colonne Action et boutons Vérifier cette source supprimés de la liste. Sélection par cases puis Vérifier la sélection, y compris pour une seule source. Motifs des cases indisponibles conservés dans title/aria-label ; examen individuel des tentatives bloquées conservé. 49 tests factices passent ; aucun rejeu réel.

Parcours simplifié : workflow-picker.mjs fournit combobox avec recherche serveur intégrée (250 ms), navigation clavier, pagination et protection contre réponses dépassées. Choix explicite charge les exécutions ; IDs de source/workflow internes masqués, aucune saisie d’ID en étape 01. Vérification individuelle depuis les lignes, panneau à la demande après la liste. 49 tests factices passent, navigateur local inaccessible pour contrôle visuel.

Recherche de workflows par partie du nom : champ dédié, Entrée/bouton Rechercher, filtre query côté serveur (noms et descriptions) et pagination sur le même filtre. Nouvelle recherche invalide bulk/approbations. 47 tests factices passent ; test navigateur local bloqué par timeout de connexion.

Pins : refus maintenu car le mode manuel utilise les pins stockés ; le DTO interne ne propose aucun ignorePins/pinData override. Message explique désépinglage et enregistrement dans l’éditeur avant nouvelle simulation. 46 tests factices passent ; aucune modification automatique du workflow.

When Executed by Another Workflow (`n8n-nodes-base.executeWorkflowTrigger`) compatible en individuel et bulk avec sorties JSON enregistrées. Exécution manuelle indépendante du workflow enfant actuel ; parent non relancé, aucun contexte/retour parent restauré. 45 tests factices passent, sources au tag 2.42.4 examinées, aucun rejeu réel. Les anciennes exclusions de sous-workflows ci-dessous sont historiques.

Traefik : Dockerfile statique séparé, nginx sans proxy n8n, Compose indépendant avec réseau externe et labels limités au chemin du manager ; overlay ACME optionnel. Valeurs fournies : n8n.rarcel.net, réseau rproxy, entrypoint websecure ; conserver TLS Vault existant sans overlay ACME. Priorité 1000 à vérifier contre le router du POC. Ne pas combiner avec le Compose sandbox. Pas de Docker disponible ici, aucune validation de déploiement revendiquée.

Lot exécutable après compatibilité intégrale et confirmation globale : réutilisation du manager individuel pour chaque revalidation/lock/marqueur/POST, aucune approbation brute persistée, arrêt au premier refus ou ambiguïté. 41 tests factices passent ; Chrome a reçu exactement deux POST simulés puis reload a bloqué un doublon. Pas de rejeu réel. Les anciennes notes de préparation ci-dessous sont historiques.

Extension aux sorties JSON enregistrées de Webhook, Schedule Trigger et Manual Trigger. Découverte des workflows accessibles activée, avec détection d'un seul déclencheur exécuté compatible ; les workflows explicitement configurés gardent leur nom de déclencheur. Chat/formulaires/sous-workflows/autres types exclus. 36 tests factices passent. Aucun test réel des nouveaux types.

Liste d'exécutions via GET /rest/executions : filter workflowId/status/startedAfter/startedBefore, limit=50 et cursor opaque, contrat vérifié au tag 2.42.4. Cases explicites, sélection jusqu'à 50 conservée entre pages ; changements de filtres/workflow et erreurs de pagination/session invalident les choix. 34 tests factices passent ; parcours Chrome factice et rendu mobile vérifiés. `scripts/preview-fixtures.mjs` ne relaie rien et refuse toutes les écritures. Les notes de migration ci-dessous décrivent les étapes précédentes ; la pagination n'est plus en attente.

Sélecteur de workflows accessible ajouté avec noms et IDs, pagination take/skip et scopes n8n. Seuls les workflows configurés, non archivés et avec droits read/execute sont sélectionnables. 29 tests factices passent ; aucun changement de configuration de rejeu.

Préparation bulk ajoutée : saisie explicite de 1 à 50 IDs du même workflow, refus des doublons, vérification séquentielle individuelle et récapitulatif de métadonnées, sans approbation conservée ni POST bulk. 26 tests factices passent. La pagination attend la vérification du contrat détaillé de liste n8n 2.42.4 (sources détaillées indisponibles pendant cette itération). Confirmation globale, envoi séquentiel, arrêt et suivi individuel restent à implémenter. Politique future : arrêt au premier refus ou envoi ambigu, sans retry automatique ; voir README. Panneau non testé visuellement ni sur instance réelle.

Exécuter node scripts/validate.mjs depuis la racine : 23 tests à la migration. Docker et Traefik réels non testés ici. Captures précédentes illustrant le thème, pas le dernier libellé de confirmation.

Modifier directement ce dépôt, consulter les différences et produire des commits explicites. Ne plus échanger de ZIP pour les itérations normales. Aucun remote configuré et aucun secret intégré. Ne pas pousser, publier, déployer ou rejouer réellement sans demande applicable.

Parcours progressif : workflow (01), sélection (02), vérification/lancement/suivi (03). Reset efface le parcours sans supprimer les marqueurs locaux. Redirection vers / sur open_editor_first ou session_expired, aucune connexion automatisée. Version logicielle absente de l’UI, version workflow cible conservée. 59 tests factices passent ; validation visuelle/authentification réelle restante.
