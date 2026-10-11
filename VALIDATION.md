# Validation — 11 octobre 2026

## Réalisé

- Préparation bulk en lecture seule : 26 tests Node réussis, 0 échec via `node scripts/validate.mjs`. Nouveaux tests : IDs uniques et limite de 50, un seul workflow, résultats individuels dont données masquées, absence de POST/persistance de payloads, arrêt sur changement de compte ou de définition actuelle. Aucun lot réel envoyé. Le nouveau panneau n'a pas été validé visuellement dans un navigateur ni sur une instance n8n réelle.

- Sources publiques au tag n8n@2.42.4 consultées : identifiant navigateur, headers REST, compte courant, scopes, lecture et redaction des exécutions, sérialisation flatted, DTO et moteur de rejeu.
- Contrat ITaskData corrigé par rapport au premier POC : sorties sous triggerToStartFrom.data.data.main.
- 23 tests Node réussis, 0 échec, Node 24.16.0 ; syntaxe JavaScript et empreinte du décodeur vérifiées. Le rejeu dans le workflow actuel est accepté avec version historique absente/différente, sans définition injectée. Version actuelle absente ou changement de version/nodes/connections/settings entre aperçu et envoi : refus sans POST. Cette révision n'a pas été testée sur l'instance utilisateur ni capturée dans le navigateur ; les captures précédentes illustrent le thème et pas le nouveau libellé de confirmation.
- Interface chargée dans le navigateur local ; bouton de vérification essayé sans session n8n : demande de connexion, aucun lancement.
- Parcours navigateur complet testé avec un serveur local de réponses factices : lecture flatted, simulation, bouton bloqué avant confirmation, une soumission factice, contrôle du résultat, rechargement puis blocage d'un second envoi. Le serveur factice a reçu exactement un POST. Ce test n'accède à aucune instance n8n.
- Rendu desktop examiné, capture livrée séparément ; contrôle à 390 pixels de largeur sans débordement horizontal.
- Révision visuelle : style aligné sur les primitives/tokens n8n 2.42.4, police Inter locale avec licence OFL, préférence N8N_THEME en lecture seule. Les captures du nouveau thème remplacent le premier rendu vert.
- Aucun credential, cookie ou clé API collecté ; aucune connexion à l'instance utilisateur, aucun rejeu réel.

Les tests couvrent source flatted, ITaskData et nesting exact, absence de mutation, refus de droits/version/pins/binary/redaction/ambiguïté, simulation, confirmation, revalidation, changement de compte, réserve persistante, réponse perdue, waitingForWebhook, verrou multi-onglets simulé, stockage indisponible, déblocage explicite, contrôle de résultat et headers de session. Les API et Web Locks sont simulés dans les tests ; le contrat réel et le verrouillage multi-onglets doivent aussi être vérifiés sur le navigateur cible.

## Non validé ici

Docker n'est pas installé dans l'environnement. L'image nginx, sa configuration au démarrage, Compose et l'intégration réelle n8n n'ont pas été exécutés. La navigation testée utilise l'aperçu sans backend ou un serveur de réponses factices ; le parcours complet après authentification n'a pas été testé dans une instance n8n réelle.

## Matrice à compléter sur une instance autorisée

| Contrôle | Attendu |
|---|---|
| Image et proxy | Image n8n officielle 2.42.4 intacte ; nginx non root, assets mjs/CSS avec bons MIME |
| URL | Même origine exacte pour éditeur, manager et /rest ; pas de domaine/port distinct |
| Cookie et contexte | Connexion normale dans l'éditeur, cookie HttpOnly automatiquement envoyé, browser-id réutilisé |
| Session absente/expirée ou MFA requise | Refus des données/opérations ; pas de collecte de credentials ni contournement |
| Réponses éditeur | Enveloppe data ; scopes workflow:read/execute ; snapshot versionId ; données flatted |
| Source inaccessible | GET refusé ou données absentes ; pas de POST |
| Droits insuffisants ou révoqués | Contrôles n8n refusent la lecture/soumission |
| Version historique absente/différente | Aperçu accepté avec destination actuelle et confirmation explicite |
| Version actuelle absente ou modifiée après aperçu | Rejeu bloqué avant POST |
| Pins/binary/redaction | Simulation bloquée sans demander de démasquage |
| Simulation 942538 | Métadonnées affichées, pas de nouvelle exécution |
| Rejeu sandbox contrôlé | Données Webhook attendues effectivement reçues par les nodes, nouvel ID, bon workflow, mode manual |
| Résultat | Soumission distincte de réussite ; contrôle de résultat et effets métier |
| Deux onglets | Une soumission, second onglet bloqué par lock/marqueur |
| Refresh après soumission ou réponse perdue | Blocage conservé ; vérification n8n avant déblocage explicite |
| Autre appareil/profil | Limite documentée : marqueur local non partagé |
| Credentials, subworkflows, queue/offload, runners | Tester selon l'environnement et les droits actuels |
| Avant/après workflow | Pas de requête d'import/update/activate/deactivate du manager ; examiner séparément les effets de ses nodes |
| Proxy HTTPS existant | Headers de confiance, cookies, WebSockets et CSP n8n inchangés |

942541 est une observation antérieure rapportée par l'utilisateur. Ce projet ne la revendique pas comme preuve de son intégration. Effectuer les tests de soumission d'abord avec un workflow autorisé dont les effets sont contrôlés.
