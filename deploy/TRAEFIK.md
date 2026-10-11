# Intégration au Traefik existant — préparée, non déployée

Le service dédié sert uniquement les fichiers sous `/replay-manager/`. Traefik continue d'envoyer `/`, `/rest/`, les webhooks et WebSockets directement vers votre service n8n existant. Aucune chaîne de proxy supplémentaire pour n8n, aucune modification de son image, de ses cookies ou de `N8N_PROXY_HOPS`. Le serveur statique ne possède aucun upstream n8n et refuse les autres chemins.

Les fichiers `compose.traefik.yaml` et `deploy/Dockerfile.traefik` sont indépendants du Compose sandbox. Ne pas les combiner avec `compose.yaml`. Le réseau externe doit déjà relier Traefik aux services. Aucun port du manager n'est publié sur l'hôte et aucun socket Docker n'est monté dans le manager.

Les valeurs fournies sont renseignées dans `deploy/traefik.env.example` : hôte `n8n.rarcel.net`, réseau externe `rproxy`, entrypoint HTTPS `websecure`. Copier ce fichier vers `deploy/traefik.env.local`. La priorité proposée `1000` reste à comparer au router n8n du POC : elle doit être strictement supérieure. L'entrypoint doit servir le même port public HTTPS que l'éditeur. Les labels supposent le provider Docker ; Swarm nécessite une adaptation. Si une authentification externe ou des middlewares d'accès sont nécessaires pour les assets, reprendre explicitement la politique de l'installation pour ce nouveau router.

Les certificats sont émis par le Vault interne et la configuration TLS du POC fonctionne déjà : conserver cette configuration dans Traefik et utiliser seulement `compose.traefik.yaml`. Le manager ne contacte pas Vault et ne reçoit aucun certificat privé ou credential Vault. Aucun certResolver ACME n'est renseigné pour cette installation. Comparer les éventuels TLSOptions et middlewares du POC avant intégration.

Sans overlay ACME, le router utilise la configuration TLS/certificats déjà disponible dans Traefik. Si l'installation utilise un certResolver, ajouter `compose.traefik-acme.yaml` et renseigner son nom existant. Ne pas créer un resolver, une redirection HTTP ou un service Traefik concurrent dans cette stack. Les noms de router/service `replay-manager` doivent être disponibles ; adapter tous les labels si ces noms existent déjà.

Pour une relecture de configuration seulement, depuis la racine :

```powershell
docker compose --env-file deploy/traefik.env.local -f compose.traefik.yaml config --quiet
# Variante pour une autre installation utilisant un resolver (variable à renseigner) :
docker compose --env-file deploy/traefik.env.local -f compose.traefik.yaml -f compose.traefik-acme.yaml config --quiet
docker build -f deploy/Dockerfile.traefik -t local/replay-manager-static .
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL local/replay-manager-static -t
```

Ces commandes ne démarrent ni n8n ni Traefik et ne rejouent aucune exécution. Elles restent à exécuter sur une machine autorisée avec Docker. Le tag nginx est évolutif : après validation de l'image, pinner son digest. Aucun déploiement n'est effectué par ce dépôt.

Lors d'une validation autorisée, contrôler les MIME mjs/CSS/fonts, la CSP du manager, la redirection relative `/replay-manager` vers `/replay-manager/` et l'absence de capture de `/replay-manager-other`. L'éditeur, le manager et `/rest/login` doivent rester sur la même origine exacte. Les routes REST restent sur le router n8n et conservent ses protections. Les assets statiques sont publics et ne contiennent aucune donnée privée ; les données sont contrôlées par n8n sur chaque requête.

Sources : [règles et priorités Traefik](https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/rules-and-priority/), [labels Docker et réseau](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/docker/).
