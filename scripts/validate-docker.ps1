$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker required' }
    docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Invalid Compose configuration' }
    docker build -t local/n8n-replay-manager:0.2.0 .
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    # Configuration validation only; the hosts entry avoids a running n8n dependency.
    docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --add-host n8n:127.0.0.1 local/n8n-replay-manager:0.2.0 -t
    if ($LASTEXITCODE -ne 0) { throw 'nginx configuration invalid' }
    Write-Output 'Compose, image and nginx checked. No n8n execution submitted.'
} finally { Pop-Location }
