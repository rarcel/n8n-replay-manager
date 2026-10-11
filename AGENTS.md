# Projet navigateur Replay Manager

- Lire README.md et VALIDATION.md avant toute modification.
- Préserver le style n8n : Inter locale, couleurs neutres, boutons orange/corail, densité compacte, thèmes clair/sombre selon N8N_THEME en lecture seule. Ne pas imposer une identité visuelle distincte ni modifier la préférence de l'éditeur. Traefik est la cible de déploiement ; ne pas appliquer les exemples nginx comme configuration de production sans adaptation.
- Le rejeu se fait exclusivement dans le navigateur connecté à n8n. Pas de passerelle de service, compte technique, clé API, cookie exporté, login automatisé, endpoint backend de rejeu ou injection DI.
- Conserver l'image officielle n8n 2.42.4 intacte. Le Dockerfile construit uniquement le serveur de fichiers/reverse proxy.
- Même origine exacte (schéma, hôte et port) pour l'éditeur, /replay-manager/ et /rest/. Réutiliser n8n-browserId existant ; ne pas générer, modifier ou journaliser cet identifiant.
- L'authentification et les permissions sont contrôlées par n8n sur chaque requête. Ne pas désactiver MFA, browser-id, scopes, redaction ou protections de session. Ne pas demander redactExecutionData=false.
- Aucune écriture, import, activation/désactivation ou modification du workflow par le manager. Ne pas confondre avec les effets métier exécutés par ses nodes.
- Conserver simulation préalable, confirmation explicite, relecture des droits/version/source et comparaison du plan avant POST.
- triggerToStartFrom.data doit être un ITaskData contenant data.main, pas directement main. Garder ce contrat couvert par un test.
- Rejouer les données source dans le workflow actuel, conformément au choix explicite de l'utilisateur. Autoriser version historique absente/différente ; exiger version actuelle disponible et vérifier version, nodes, connections, settings entre aperçu et envoi. Afficher et confirmer la destination actuelle. Refuser données masquées, binaires, pins, runs multiples et structures incompatibles.
- Ne pas lire document.cookie, collecter de credentials, ajouter un script externe ou persister des payloads. Afficher les valeurs reçues via textContent ; aucune insertion HTML de données n8n.
- Le marqueur local doit précéder le POST ; pas de retry automatique. Web Locks et stockage local obligatoires pour les soumissions. Déblocage uniquement après acknowledgement explicite. Ne pas présenter ce mécanisme comme une idempotence serveur ou entre appareils.
- Tests factices uniquement. Aucun rejeu de production pour vérifier une modification. Exécuter node scripts/validate.mjs ; valider Docker et l'authentification réelle seulement dans une instance autorisée et avec effets maîtrisés.
- Conserver flatted et sa licence, sa version vérifiée et son empreinte. Vérifier les avis upstream avant toute mise à jour.
- L'intégration via routes éditeur reste interne et à valider, sans garantie de support officiel.
