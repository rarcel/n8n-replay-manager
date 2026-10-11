# Replay Manager — navigateur n8n 2.42.4

Cette version remplace le POC de passerelle de service. Le rejeu se fait exclusivement dans le navigateur : une interface statique sous **`/replay-manager/`**, sur la même origine que n8n, utilise la session de l'utilisateur. Aucune image n8n modifiée, clé API, session exportée, authentification de service ou injection DI.

L'interface reprend les surfaces neutres, la police Inter, les boutons orange/corail et les dimensions compactes de n8n 2.42.4. Elle lit la préférence `N8N_THEME` (`light`, `dark`, `system`) du même navigateur sans la modifier, et suit les changements de thème de l'éditeur. C'est une interface distincte : elle ne charge pas les bundles privés n8n et les personnalisations de thème propres à votre installation ne sont pas automatiquement reprises.

**Cible de déploiement retenue : Traefik.** Un modèle indépendant de serveur statique et de labels est préparé dans `compose.traefik.yaml` et [deploy/TRAEFIK.md](deploy/TRAEFIK.md). Les valeurs `n8n.rarcel.net`, réseau `rproxy` et entrypoint `websecure` sont renseignées. La configuration TLS existante alimentée par Vault est conservée, sans resolver ACME. La priorité et les éventuels middlewares/TLSOptions restent à comparer au POC. Aucun déploiement n'est effectué. Le Dockerfile et Compose à la racine restent une sandbox nginx distincte.

Le Dockerfile construit uniquement un serveur nginx non root pour l'interface et le reverse proxy. Compose utilise directement `docker.n8n.io/n8nio/n8n:2.42.4`, sans dérivation. Les routes éditeur utilisées sont internes ; leur schéma et leur comportement doivent être validés sur l'instance cible. Le POC ne transforme pas ces routes en API officiellement supportée.

## Architecture

```text
Navigateur connecté
  https://n8n.exemple.fr/replay-manager/  -> fichiers statiques
  https://n8n.exemple.fr/rest/…          -> n8n officiel
  https://n8n.exemple.fr/                -> éditeur n8n
```

La même origine signifie **même schéma, hôte et port**, pas seulement le même domaine principal. Ouvrir l'éditeur sur un port et le manager sur un autre ne partage pas le stockage navigateur attendu. Ce projet suppose n8n à la racine avec `/rest` ; une installation sous un autre préfixe nécessite d'adapter puis tester les chemins et le reverse proxy.

La page statique est accessible sans session et ne contient aucune donnée privée. La lecture des données et la soumission sont authentifiées par n8n. Chaque requête utilise `credentials: "same-origin"` et le header `browser-id` contenant la valeur **existante** de `localStorage['n8n-browserId']`. L'interface ne lit pas le cookie HttpOnly ; le navigateur l'envoie automatiquement selon ses règles. Aucun identifiant n8n n'est créé ou écrasé par le manager. En l'absence de contexte, il demande d'ouvrir l'éditeur et de s'y connecter normalement.

Seuls ces appels sont effectués :

| Opération | Appel |
|---|---|
| Vérifier le compte courant | GET `/rest/login` |
| Choisir un workflow accessible | GET `/rest/workflows?take=100&skip=…&includeScopes=true` |
| Filtrer les résumés d'exécution | GET `/rest/executions?limit=50&filter=…&cursor=…` |
| Lire source/résultat | GET `/rest/executions/{id}` |
| Lire le workflow et ses scopes | GET `/rest/workflows/{id}` |
| Soumettre après confirmation | POST `/rest/workflows/{id}/run` |

Aucun POST login, retry natif, API publique ou endpoint de modification de workflow n'est utilisé. n8n contrôle session, lecture de l'exécution, scopes du workflow et exécution. L'interface vérifie en plus les scopes `workflow:read` et `workflow:execute`. Le contrôle client n'est pas une frontière d'autorisation : les permissions côté n8n font autorité. `web/config.mjs` conserve les noms de déclencheurs explicites et active la découverte des workflows accessibles ; désactiver cette découverte rétablit la liste configurée comme garde-fou client.

## Étape 1 — vérifier les fichiers

Prérequis pour les tests : Node >=22. Aucun npm install requis. Le décodeur flatted 3.4.4 et sa licence ISC sont intégrés localement ; aucune ressource distante n'est chargée par l'interface.

```powershell
node scripts/validate.mjs
```

Pour voir uniquement l'interface sans instance n8n :

```powershell
node scripts/preview.mjs
```

Ouvrir `http://127.0.0.1:8088/replay-manager/`. Cet aperçu n'a **aucun backend n8n**, refuse les routes métier et ne peut pas rejouer. Il affiche donc normalement une demande de connexion à l'éditeur. Ne pas utiliser cet aperçu pour accéder à la session d'un autre domaine.

## Étape 2 — utiliser votre domaine existant

Le chemin le plus direct consiste à servir les fichiers `web/` depuis votre reverse proxy HTTPS existant, sans changer n8n. Copier leur contenu dans `/srv/replay-manager/`, puis intégrer `deploy/existing-nginx-location.conf` dans le serveur HTTPS du domaine de n8n. Ce snippet utilise un alias local ; il suppose que les fichiers sont présents dans le serveur/conteneur nginx. Conserver les routes, headers, WebSockets, cookies et protections n8n existants. Le script mjs doit être servi avec un MIME JavaScript et les styles avec un MIME CSS.

La configuration complète `deploy/nginx.conf` illustre une autre option : un conteneur dédié sert les fichiers sous `/replay-manager/` et relaie les autres chemins à `n8n:5678`. Pour l'intégrer derrière votre reverse proxy, conserver une seule origine extérieure et adapter la confiance et les headers du proxy à la chaîne réelle. Ne pas exposer ce conteneur via un autre domaine ou port pour le parcours utilisateur. Les variables n8n `N8N_EDITOR_BASE_URL`, `WEBHOOK_URL`, `N8N_PROXY_HOPS` et la configuration HTTPS doivent refléter votre installation ; le Compose fourni n'est qu'une sandbox HTTP locale.

Le modèle Traefik inclut les valeurs d'infrastructure fournies, sans credential ni session. Les certificats HTTPS restent gérés par votre configuration Traefik existante. Le code de l'interface partage le périmètre de confiance de l'éditeur : maintenir ses dépendances, éviter les scripts externes et conserver sa CSP. La CSP fournie s'applique uniquement aux fichiers du manager et ne remplace pas celle des pages n8n.

## Alternative — sandbox Docker neuve

```powershell
./scripts/validate-docker.ps1
docker compose up -d --build
```

Ouvrir d'abord `http://localhost:8080/`, effectuer l'installation/connexion n8n normale, puis `http://localhost:8080/replay-manager/` **dans le même navigateur**. Ne pas alterner localhost et 127.0.0.1. Le navigateur doit supporter Web Locks et le stockage local ; localhost fonctionne comme contexte sécurisé dans les navigateurs récents. Sur un serveur distant, HTTPS est requis.

Cette instance est neuve : elle ne contient ni votre workflow ni l'exécution `942538`. Utiliser un workflow de test existant et autorisé avec des effets contrôlés ; ne pas importer une production pour contourner des droits. Les workflows accessibles sont découverts dans le catalogue et leur compatibilité est contrôlée à la simulation. `web/config.mjs` permet de fixer explicitement un nom de déclencheur. Par défaut, `Q4WmdAk9qV7zpK97` garde le nom `Webhook` et `942538` est préremplie. Ces identifiants proviennent du contexte utilisateur.

Le Compose publie seulement le reverse proxy sur la boucle locale ; n8n est accessible par son réseau Docker. `N8N_SECURE_COOKIE=false` est réservé à cette sandbox HTTP. En HTTPS réel, garder les cookies sécurisés et la configuration autorisée de l'instance. L'image nginx `stable-alpine` est un tag évolutif : après validation, pinner son digest dans votre déploiement. Pinner également le digest de n8n 2.42.4 si vous exigez une reconstruction immuable.

## Étape 3 — vérifier puis rejouer

### Rejeu d'une sélection bulk

Choisir un workflow par son nom, puis utiliser les filtres **Succès et erreurs**, **Erreurs** ou **Succès** et l'intervalle de démarrage. Les dates sont saisies dans le fuseau du navigateur, converties en UTC pour n8n ; les deux bornes sont incluses. Les exécutions en cours ou en attente ne sont pas proposées au rejeu. Une erreur terminale avec `finished=false` reste admise si `stoppedAt` est présent.

La liste est paginée par 50 résumés avec le curseur opaque `nextCursor` retourné par n8n 2.42.4, sans `firstId`/`lastId`. Le total peut être estimé ou indisponible. Cocher explicitement jusqu'à 50 sources ; les choix sont conservés entre les pages et effacés si le workflow ou les filtres changent. Aucune sélection automatique de toutes les correspondances n'est effectuée. **Vider la sélection** efface les choix, et **Vérifier cette source** ouvre la simulation individuelle sans lancement.

**Vérifier la sélection** relit chaque source selon les règles du rejeu individuel. Le récapitulatif affiche ID, compatibilité, nombre d'éléments et destination actuelle ; les tentatives locales existantes sont signalées comme bloquées. Les résumés ne prouvent pas la compatibilité des données. Les IDs non numériques, sources sans fin ou sans scopes requis ne sont pas sélectionnables. Aucun payload ni sélection n'est persisté. Modifier la sélection efface le récapitulatif. Une réponse de liste incompatible, un curseur répété ou un changement de compte vide la sélection.

Après une vérification entièrement compatible, examiner les IDs, les déclencheurs, le total d'éléments, le workflow actuel et sa version, puis cocher la confirmation des effets et cliquer **Lancer le lot**. Une source bloquée empêche tout le lot : la retirer et revérifier, sans exclusion silencieuse. Les approbations conservent uniquement IDs et empreintes en mémoire, sans payload, et expirent après cinq minutes. Chaque source, workflow et compte sont relus avant son POST, avec comparaison au plan approuvé.

Un aperçu interactif avec réponses factices est disponible via `node scripts/preview-fixtures.mjs`, puis `http://127.0.0.1:8090/replay-manager/`. Il utilise un identifiant synthétique uniquement en mémoire dans son adaptateur de test, sans toucher à `n8n-browserId`. Par défaut il refuse toutes les écritures. Pour le parcours de soumission factice, lancer dans PowerShell `$env:FIXTURE_RUNS='1'; node scripts/preview-fixtures.mjs` : seuls des POST synthétiques locaux sont acceptés, sans relais ni exécution de workflow. Ne pas déployer ce script comme serveur du manager.

Les POST sont séquentiels, avec Web Lock et marqueur individuel avant chaque envoi. Le lot s'arrête au premier refus de revalidation/soumission, à une réponse perdue ou à une attente Webhook. **Arrêter après l'envoi en cours** laisse les sources restantes non envoyées ; il ne peut pas annuler une tentative en cours. Les IDs reçus signifient seulement **soumis** ; cette politique ne détecte pas automatiquement une erreur métier survenant après la réponse du POST. Utiliser **Vérifier le résultat** pour chaque source, sans polling automatique. **Examiner la tentative** ouvre le panneau individuel ; tout déblocage reste soumis à acknowledgement explicite. Après arrêt/erreur, sélectionner uniquement les sources non envoyées et effectuer une nouvelle simulation et confirmation, sans retry automatique.

### Rejeu individuel

1. Se connecter à l'éditeur n8n sur la même origine.
2. Ouvrir `/replay-manager/`, choisir le workflow par son nom dans la liste accessible, saisir l'ID source puis cliquer **Vérifier la source**. Le bouton **Plus de workflows** charge la page suivante. Les workflows archivés ou sans droits de lecture/exécution sont non sélectionnables ; les autres restent soumis à la compatibilité du déclencheur. Cette étape est uniquement en lecture.
3. Examiner le workflow, le déclencheur et le nombre d'éléments ; confirmer les effets possibles.
4. Cliquer **Lancer le rejeu**. Session, source et workflow sont relus et le plan est comparé au plan approuvé. Une vérification expire après cinq minutes.
5. Un nouvel ID signifie seulement **soumis**. Cliquer **Vérifier le résultat**, puis examiner l'exécution et les effets métier dans n8n.

Le résultat est relu à la demande, sans polling automatique. Le contrôle vérifie nouvel ID, workflow et mode manuel ; il distingue une réussite, une erreur et une exécution encore en cours. Aucun payload ni résultat métier brut n'est affiché, logué ou persisté par le manager ; les données source sont nécessairement reçues en mémoire par le navigateur autorisé, et restent visibles dans ses outils réseau.

Le contexte fourni rapporte qu'un POST éditeur précédent a créé `942541` depuis `942538`, validée par l'utilisateur. Cette observation n'a pas été reproduite par ce projet. Ne pas la présenter comme un test d'intégration du manager.

## Payload et conditions couvertes

La découverte des workflows accessibles est activée (`discoverWorkflows: true`). Le manager peut réutiliser les sorties JSON enregistrées de **Webhook**, **Schedule Trigger**, **Manual Trigger** et **When Executed by Another Workflow** (`n8n-nodes-base.executeWorkflowTrigger`), dans le workflow actuel. Le déclencheur est identifié par son nom et son type actuel parmi les passages enregistrés ; plusieurs candidats, passages multiples, changement de type historique connu ou déclencheur désactivé sont refusés. Le nom configuré reste prioritaire pour les workflows déjà configurés. Désactiver la découverte rétablit la liste explicite. La sélection dans le catalogue ne prouve pas la compatibilité.

Cette extension ne déclenche pas un nouvel événement, ne réarme pas un planning et ne reprend pas une attente. Pour **When Executed by Another Workflow**, sélectionner le workflow enfant et ses propres exécutions. Les sorties JSON enregistrées du déclencheur sont fournies au workflow actuel : nouvelle exécution manuelle indépendante, sans relance du parent, restauration du contexte parent ni retour de résultat au parent. Le manager ne reconstruit pas les entrées du node Execute Sub-workflow appelant ; examiner le schéma et les expressions du workflow actuel. Chat, formulaires, error triggers et triggers communautaires restent hors périmètre. Les nouveaux types sont couverts par des fixtures ; leurs effets réels restent à valider sur une instance autorisée.

La source doit appartenir au workflow et être terminée (`success` ou `error`, avec `stoppedAt`). Les erreurs terminales n8n peuvent avoir `finished=false` ; ce champ seul ne bloque donc pas leur lecture. Les données source sont rejouées dans le **workflow actuel**, même si la version historique est absente ou différente. La version actuelle doit être disponible et rester stable entre aperçu et envoi ; les nodes, connections et settings relus sont également comparés. Le POC refuse toutes les données épinglées, les binaires, les données signalées comme masquées par n8n, les multiples passages du trigger, les erreurs du trigger et un déclencheur désactivé ou d'un type différent.

L'API éditeur renvoie les données dans une enveloppe `data`, avec les données d'exécution éventuellement sérialisées via flatted. Le manager décode ce format ; il n'effectue aucune requête pour demander le démasquage. Réponse HTTP ou données d'exécution >8 MiB refusées ; payload de rejeu >2 MiB et >1 000 items refusés. Une réponse sans schéma/scopes/version compatibles bloque l'opération.

**Le payload est un ITaskData issu de `runData[nomDuDéclencheur][0]`, avec les sorties sous `triggerToStartFrom.data.data.main`.** Les timings du passage source et son index valide sont conservés ; les sorties sont copiées sous forme d'items JSON, sans références binaires ni pairedItem. Les sources de provenance sont réinitialisées à une liste vide, et les métadonnées/entrées annexes ne sont pas retransmises. Aucun workflowData/runData complet fourni par le navigateur ne sert de définition à exécuter. Le contrôleur n8n charge son workflow stocké.

Le premier POC avait placé `main` un niveau trop haut. Cette version corrige ce défaut et le couvre par un test. L'ancien projet doit rester une archive et ne doit pas être déployé pour ce parcours.

## Protection locale contre les doubles envois

### Diagnostic des versions

Le choix explicite est de réutiliser les données du Webhook avec la définition et les credentials actuels. La version historique absente ou différente ne bloque plus. La destination actuelle et sa version sont affichées avant confirmation. Aucune définition historique n'est injectée et aucune version source n'est falsifiée. Une version actuelle absente bloque toujours ; une modification entre aperçu et relecture bloque avant POST. La définition relue sert uniquement au digest en mémoire, jamais au payload ni au stockage local. Le POST interne ne fournit pas de précondition atomique de version : une modification entre la dernière lecture et l'exécution reste possible, et doit être évitée pendant le rejeu. Le manager ne garantit donc pas une reproduction historique ni un verrou serveur du workflow.

Le manager utilise Web Locks entre onglets d'une même origine, et écrit un marqueur dans son stockage local **avant** le POST. La clé distingue le compte n8n, le workflow et l'exécution source. Le marqueur contient uniquement IDs, date, état et nouvel ID éventuel. Après rechargement, une tentative existante bloque un nouvel envoi pour cette source.

Un timeout, une réponse illisible, une erreur ou `waitingForWebhook` conserve le blocage. Aucun POST n'est réessayé automatiquement. Vérifier les exécutions dans n8n puis, si une nouvelle tentative est voulue, utiliser le panneau **Autoriser une nouvelle tentative**, confirmer le risque et lever explicitement le blocage. Une nouvelle vérification reste obligatoire. En cas d'attente Webhook, examiner cette attente via les fonctions autorisées n8n avant toute nouvelle action.

Ce n'est **pas une idempotence serveur**. Un autre appareil, un autre profil, l'effacement du stockage ou un envoi hors interface peut créer un doublon. Les marqueurs ne sont ni un journal d'audit inviolable ni une déduplication métier. Une garantie entre appareils nécessiterait une coordination serveur supplémentaire ; elle n'est pas incluse dans cette architecture navigateur.

## Limites du mode manuel et des credentials

Le rejeu crée une nouvelle exécution manuelle ; il ne reprend pas une exécution suspendue et ne restaure pas tous ses résultats intermédiaires. Les nodes peuvent répéter leurs actions, y compris des modifications qu'ils effectuent eux-mêmes dans n8n. Le manager n'envoie aucune requête de modification, activation ou import du workflow.

Les credentials et leur contexte sont ceux du workflow et de la session courante, pas une copie historique. Des tokens expirés, credentials supprimés/dynamiques ou devenus inaccessibles peuvent empêcher l'exécution. Les données JSON du Webhook peuvent aussi contenir des headers ou tokens anciens. Vérifier séparément expressions, subworkflows, runners, mode queue/offload, error workflows et différences manuel/production. Cookie optionnel dans executeManually ne veut pas dire contexte credentials interchangeable ; le parcours conserve la session de l'utilisateur.

Les routes éditeur et la lecture de `n8n-browserId` restent des contrats internes propres à la version examinée. Aucune désactivation d'authentification, MFA, browser-id, redaction, scopes ou sandbox n'est proposée. Si l'instance exige un contexte différent, la corriger par les mécanismes n8n autorisés ou considérer cette version du POC comme incompatible.

## Fichiers et sources

`web/` contient l'interface, l'adaptateur navigateur et le validateur du payload ; `deploy/` contient nginx ; `test/` contient uniquement des fixtures factices ; `scripts/` contient validation et aperçu sans n8n. `AGENTS.md` encadre les changements futurs et `VALIDATION.md` distingue tests locaux et validations réelles restantes.

Sources examinées au tag n8n@2.42.4 :

- [Couleurs et primitives](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/frontend/%40n8n/design-system/src/css/_primitives.scss), [tokens du thème](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/frontend/%40n8n/design-system/src/css/_tokens.scss) et [préférence locale](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/frontend/editor-ui/src/app/constants/localStorage.ts). Inter est servie localement avec sa licence OFL dans `web/fonts/`.

- [Identifiant navigateur](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/%40n8n/constants/src/browser.ts) et [client REST](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/frontend/%40n8n/rest-api-client/src/utils.ts).
- [Authentification](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/cli/src/auth/auth.service.ts) et [compte courant](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/cli/src/controllers/auth.controller.ts).
- [Lecture et droits des exécutions](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/cli/src/executions/executions.controller.ts) et [sérialisation](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/cli/src/executions/execution.service.ts).
- [Pagination par curseur](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/cli/src/executions/parse-range-query.middleware.ts), [réponse de liste](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/cli/src/executions/execution-list-v1.service.ts), [bornes de dates](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/%40n8n/db/src/repositories/execution.repository.ts) et [pagination des workflows](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/cli/src/middlewares/list-query/pagination.ts).
- [Contrôleur de rejeu](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/cli/src/workflows/workflows.controller.ts), [DTO](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/%40n8n/api-types/src/dto/workflows/manual-run.dto.ts), [moteur](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/core/src/execution-engine/workflow-execute.ts) et [test webhooks](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/cli/src/webhooks/test-webhooks.ts).
- [Déclencheur sous-workflow](https://github.com/n8n-io/n8n/blob/n8n%402.42.4/packages/nodes-base/nodes/ExecuteWorkflow/ExecuteWorkflowTrigger/ExecuteWorkflowTrigger.node.ts) : identité du node, sortie main et modes d’entrée examinés au tag 2.42.4.
- [Avis de sécurité flatted](https://github.com/WebReflection/flatted/security/advisories) ; version 3.4.4 intégrée avec licence et empreinte vérifiée.
