# n8n Replay Manager

Replay saved execution data or retry failed executions from a compact browser interface, using your existing n8n session. Search workflows by name, filter executions by status and start date, review a selection, then explicitly confirm before submitting.

The interface uses French when the browser’s primary language is French (including fr-FR and fr-CA), and English for every other language. Workflow names and received data are never translated. The n8n theme preference is read without changing it; Inter and all assets are served locally.

## Features

- Searchable workflow selector with keyboard navigation and automatic execution loading.
- Status and inclusive start-date filters, paginated execution list and explicit selection across pages, with additional acknowledgement above 50 sources.
- Replay from saved JSON trigger outputs into the **current workflow**, or native retry from saved failure state using the **current workflow**.
- Read-only preview, destination/version review, explicit confirmation and revalidation before every submission.
- Sequential batches, stop between submissions, links to results and on-demand result checks.
- Progressive steps, session redirection to the editor and page reset for a new selection.
- Local protection against duplicate submissions across tabs and reloads.

This is an independent integration using **internal n8n editor routes**, not an officially supported n8n API client. Contracts were examined against n8n **2.42.4**; other versions are not claimed compatible. Automated tests are synthetic. Real authentication, Docker/Traefik deployment and business effects require validation in an authorized test instance; see [VALIDATION.md](VALIDATION.md).

## Deploy alongside an existing n8n instance

Serve the contents of web/ at **/replay-manager/** on the **exact same origin** as the editor and /rest/: same scheme, hostname and port. The project assumes n8n at the origin root. A different n8n base path requires adaptation and validation.

~~~text
https://n8n.example.com/                 -> existing n8n editor
https://n8n.example.com/rest/            -> existing n8n REST routes
https://n8n.example.com/replay-manager/  -> manager static files
~~~

The manager contains no backend replay service, credentials or API keys. Keep the official n8n image unchanged. The production Traefik stack builds only a static file server and routes the manager path to it; n8n requests still go directly to the existing n8n service.

### Traefik

Docker with Compose and an existing Traefik Docker-provider installation are required. From the project root:

~~~sh
cp deploy/traefik.env.example deploy/traefik.env.local
# Edit host, shared network, HTTPS entrypoint and router priority.
docker compose --env-file deploy/traefik.env.local -f compose.traefik.yaml config --quiet
docker compose --env-file deploy/traefik.env.local -f compose.traefik.yaml up -d --build
~~~

In PowerShell, use Copy-Item instead of cp if preferred. All example values are placeholders. Set the exact existing n8n hostname, the shared external Docker network and the existing HTTPS entrypoint. Router priority must exceed the n8n router for the manager path. Preserve existing certificates, TLS options and access middlewares; the manager does not provision certificates.

If your installation already uses a certificate resolver, configure its name and add -f compose.traefik-acme.yaml to the commands. Full instructions: [deploy/TRAEFIK.md](deploy/TRAEFIK.md). Do not combine this stack with the local sandbox Compose file.

### Other static hosting

Copy web/ into your HTTPS reverse proxy’s static directory and route only /replay-manager/ to it. Serve .mjs as JavaScript, .css as CSS and fonts with the correct MIME type. Preserve the manager security headers in deploy/nginx-static.conf, and preserve n8n’s existing cookies, headers, WebSockets and access controls.

[deploy/existing-nginx-location.conf](deploy/existing-nginx-location.conf) is an nginx integration example. The root Dockerfile and deploy/nginx.conf are for the separate local sandbox, not a replacement production configuration for an existing installation.

## Use the manager

1. Sign in normally to n8n, then open /replay-manager/ in the same browser and origin. Missing browser context or an expired session redirects to the editor; no credentials are collected by the manager.
2. Type part of a workflow name and choose a result. Its executions load automatically. Arrow keys and Enter select a result; Escape closes the list.
3. Choose **Replay from trigger** or **Native retry**, adjust status/start-date filters and select sources. Retry restricts the list to errors. Dates use the browser time zone and inclusive bounds. Opening an empty date control initializes today and the current local time; an existing choice is preserved. Wheel over hours or minutes to decrease (up) or increase (down), bounded between 00:00 and 23:59 without changing the date. Keyboard arrows adjust the time; Home/End go to the day boundaries. The × button clears that date bound. Selection is retained across pages; changing workflow, filters or mode clears it.
   Click an execution number to open its details in n8n in a new tab without changing the selection.
   **Select all** reads filtered pages and selects eligible summaries, including selections above 50 executions. Its scan is bounded to 100 pages per action; if exceeded, narrow the filters (previous choices are retained). **Select this page only** replaces all choices with eligible rows on the displayed page. Neither action submits anything; full source compatibility is checked later.
4. Click **Check selection**. Review all sources, the current destination workflow/version and the possible effects. One incompatible or locally reserved source blocks the whole batch; remove it and check again.
5. Confirm the effects, then start the batch. For more than 50 executions, review the displayed total and also acknowledge the additional volume warning; submission is blocked without this separate acknowledgement. Changing the selection or preparing a new preview clears the acknowledgement. Submissions are sequential. Stop takes effect after the current submission and cannot cancel a POST already sent.
6. Check each result in n8n and verify business effects. A new execution ID means **submitted**, not necessarily successful.

**Reset page** clears workflow, selection, filters, previews, confirmations and displayed results. It is disabled during an operation and retains existing attempt markers, browser identity and theme preference. To intentionally retry a previously submitted source, inspect its attempt and explicitly acknowledge the duplicate risk before releasing its local block.

## Replay and retry limitations

### Replay

Supported trigger types: **Webhook**, **Schedule Trigger**, **Manual Trigger** and **When Executed by Another Workflow**. Replay uses the saved JSON outputs of one recorded trigger run; it does not recreate an external event, re-arm a schedule or resume a waiting execution.

A subworkflow replay starts an independent manual execution of the selected child workflow. It does not run the parent, restore the parent context or return a result to the parent. Other trigger types are not currently supported for replay.

Sources must be completed success/error executions with a recorded stop time. The historical workflow version may be absent or different; the current workflow version must be available and stable. Pinned data, binary data, redacted data, trigger errors, multiple trigger runs and incompatible structures are rejected. Manual n8n execution can use stored debug pins; unpin in the editor and save before checking again. The manager never changes a workflow.

### Native retry

Retry uses POST /rest/executions/{id}/retry with only {loadWorkflow: true}. It can support failed workflows with trigger types outside the replay list, provided compatible saved execution state exists.

The source must be a terminal error with finished=false, a recorded stop time, an identified source workflow and a nonempty compatible execution stack. Waiting, redacted/binary/pinned data, repeated runs and removed/renamed/disabled/type-changed nodes to resume are rejected. These rules are deliberately more conservative than the native n8n retry button.

Retry resumes the saved stack using the current definition and credentials; saved subworkflow/parent context may be retained. A failed node may already have produced effects that will be repeated. The returned execution must match the workflow, retry mode and retryOf source. The batch stops if the last retry returns anything other than success.

## Safety and privacy

- Every request uses the existing browser session and n8n-browserId. No cookie reading/export, generated browser identifier, automated login, service account, API key or external script.
- n8n enforces authentication and permissions on each request. The manager additionally checks read/execute scopes; client checks are not an authorization boundary. Redaction is never disabled.
- The manager never imports, updates, activates or deactivates workflows. Their nodes can still execute business writes, emails, payments and other effects.
- Preview approvals last five minutes. A long verification or batch may reach that expiry and require another preview for the remaining sources. Identity, source and current workflow version/nodes/connections/settings are reread and compared before POST. There is no atomic server-side version precondition.
- Web Locks and local storage are required. A local marker is written **before** each POST. No automatic resubmission; unknown outcomes remain blocked until explicit acknowledgement.
- Markers are local to a browser profile/origin, not server idempotency or protection across devices. Replay and retry share the same markers.
- Payloads are held transiently in browser memory, never persisted in local history. Received values use textContent, never HTML insertion. Browser network tools can still expose data received by the authorized session.
- HTTP/execution data above 8 MiB, replay payloads above 2 MiB and more than 1,000 items are refused.

## Configuration

web/config.mjs enables discovery of accessible workflows by default and contains no installation-specific IDs. Optional explicit trigger names can be configured:

~~~js
workflows: Object.freeze({
  'your-workflow-id': Object.freeze({trigger: 'Recorded trigger name'}),
}),
~~~

An explicit name takes precedence over trigger discovery for that workflow. Set discoverWorkflows: false to limit the client catalogue to configured workflows. This is a client guardrail, not a replacement for n8n permissions.

## Development and synthetic preview

Node.js **22 or newer** is required. No npm install is necessary.

~~~sh
npm run validate
node scripts/preview-fixtures.mjs
~~~

Open http://127.0.0.1:8090/replay-manager/. The fixture server serves synthetic data and never connects to n8n. Its adapter uses a synthetic browser identifier in memory without writing n8n-browserId. POSTs are refused by default. To test synthetic submission locally:

~~~powershell
$env:FIXTURE_RUNS='1'
node scripts/preview-fixtures.mjs
~~~

Only local synthetic replay/retry responses are enabled. Never deploy the fixture server. npm run preview serves static files on port 8088 without any n8n backend; it cannot exercise the authenticated journey.

The optional root compose.yaml creates a **new local sandbox** with the unchanged official n8n image:

~~~sh
docker compose up -d --build
~~~

Open http://localhost:8080/ first, then /replay-manager/ on the same origin. Do not alternate localhost and 127.0.0.1. In PowerShell, scripts/validate-docker.ps1 performs sandbox configuration checks. N8N_SECURE_COOKIE=false is strictly for this local HTTP sandbox; keep secure cookies on remote HTTPS installations.

## Build a distribution

From a clean committed checkout with Git and Node.js available:

~~~sh
npm run distribute
~~~

This validates the project and writes dist/n8n-replay-manager-0.3.0.zip plus a SHA-256 checksum. The archive contains the committed source, tests, deployment templates, documentation, local assets and licenses. It excludes Git history, local environment files, agent/handoff notes and historical screenshots. It is a source/static-server distribution, not a published container image or npm release.

The source archive itself has no Git history. Existing clones retain earlier commits; sanitizing current files does not rewrite historical commits.

## License and dependencies

Project code is licensed under [Apache-2.0](LICENSE). This project is independent of n8n; it does not redistribute n8n or change its license.

- Vendored flatted **3.4.4**, ISC: web/vendor/flatted.LICENSE and web/vendor/README.md. The validator verifies its recorded SHA-256; review upstream advisories before updating it.
- Inter font, SIL Open Font License: web/fonts/Inter.LICENSE and web/fonts/README.md.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Keep these notices and license files when redistributing.
