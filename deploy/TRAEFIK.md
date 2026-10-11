# Deploy with an existing Traefik installation

The dedicated service serves only /replay-manager/. Traefik continues to route the editor, /rest/, webhooks and WebSockets directly to the existing n8n service. No changes to the n8n image, cookies, session protections or proxy hops are needed. The static server has no n8n upstream and rejects other paths.

## Configure

Copy deploy/traefik.env.example to deploy/traefik.env.local and replace every placeholder:

| Variable | Value |
|---|---|
| N8N_PUBLIC_HOST | Exact existing n8n hostname, without scheme or path |
| TRAEFIK_NETWORK | Existing external Docker network shared with Traefik |
| TRAEFIK_HTTPS_ENTRYPOINT | Existing HTTPS entrypoint serving the editor’s public port |
| REPLAY_ROUTER_PRIORITY | Priority strictly above the existing n8n router for this path |
| TRAEFIK_CERTRESOLVER | Existing resolver name, only for the optional ACME overlay |

The example priority is not guaranteed correct for your installation. Preserve any necessary access middlewares and TLSOptions. The Docker-provider labels need adaptation for Swarm. Router/service names replay-manager must be available; adapt all labels together if they collide.

Use existing Traefik certificates with compose.traefik.yaml. If you already use a certificate resolver, also use compose.traefik-acme.yaml. The stack does not create a resolver, certificates, HTTP redirection or another Traefik service. No manager host port or Docker socket is published/mounted.

## Validate and start

Run from the project root; do not combine this independent stack with compose.yaml:

~~~sh
docker compose --env-file deploy/traefik.env.local -f compose.traefik.yaml config --quiet
docker build -f deploy/Dockerfile.traefik -t local/replay-manager-static .
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL local/replay-manager-static -t
docker compose --env-file deploy/traefik.env.local -f compose.traefik.yaml up -d --build
~~~

For the resolver variant, add -f compose.traefik-acme.yaml to Compose commands. After validating images, pin their digests for reproducible deployments. These templates are not a claim of tested deployment in your environment.

## Verify routing

Check JavaScript/CSS/font MIME types, manager CSP and the /replay-manager to /replay-manager/ redirect. /replay-manager-other must not match this router. Editor, manager and /rest/login must share the exact scheme, hostname and port. n8n routes must retain their existing authentication, headers and WebSocket behavior. Static assets contain no private data; n8n checks each authenticated data request.

[Traefik routing and priority](https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/rules-and-priority/) · [Docker provider](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/docker/)
