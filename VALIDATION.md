# Validation

## Current result

Execution numbers in step 2 link to their n8n details on the same origin in a new tab. The synthetic UI test verifies the link destination, ID label, translated accessible name and opener protection.

64 synthetic tests passed via node scripts/validate.mjs. French language variants and the English fallback, static labels/accessibility attributes, untouched interpolated values and an English execution-selection/reset journey are covered. No real n8n request or replay was performed. Container deployment and visual browser checks remain outstanding.

## Automated checks

Run node scripts/validate.mjs with Node.js 22 or newer. Tests use synthetic workflows, execution IDs, browser identifiers and responses. No test connects to a real n8n instance or replays a production execution.

Covered: JSON replay payload with nested ITaskData, supported triggers, saved retry state and provenance, scopes/session/source/current workflow changes, redaction/pins/binaries/multiple runs, explicit confirmation, preview expiry, sequential bulk submissions and stop behavior, local markers before POST, Web Locks, unknown outcomes, explicit release, pagination/search, progressive journey and reset. Locale and distribution checks accompany the distribution preparation.

Vendored flatted 3.4.4 hash and JavaScript syntax are verified. French/English translation and HTML coverage checks must pass alongside behavioral tests.

## Integration checks still required

Docker/Compose/Traefik and real authenticated integration have not been validated for this release. Internal editor routes are based on n8n 2.42.4 source contracts; other versions are not claimed compatible. Prior synthetic browser observations are not real integration evidence.

| Check | Expected |
|---|---|
| Deployment | Official n8n image unchanged; only manager static server built |
| Origin | Same scheme, host and port for editor, manager and /rest/ |
| Proxy | Manager path only; n8n routes, headers, WebSockets and authentication preserved |
| Session | Normal editor login; existing browser-id reused; missing context or 401 redirects to editor |
| Permissions | Inaccessible source or revoked rights blocks submission |
| Replay | Authorized synthetic JSON source reaches expected nodes in the current workflow |
| Retry | Authorized failed source resumes compatible saved state; result mode/retryOf match |
| Current definition | Missing or changed version/nodes/connections/settings blocks submission |
| Unsafe data | Pins, binaries, redaction and incompatible structures blocked |
| Local protection | Two tabs cannot overlap; reload/unknown outcome retains marker; explicit acknowledgement required for release |
| Locale | French browser stays French; other languages use English; workflow names and source values unchanged |
| Journey | Sections appear progressively; reset clears choices and confirmations without clearing markers |
| Effects | Verify business effects separately from submission status |

Use an authorized test instance and controlled effects for integration validation. Never use production replay as an automated check.
