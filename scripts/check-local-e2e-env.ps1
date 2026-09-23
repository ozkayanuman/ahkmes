<#
  Safe local preflight for PostgreSQL E2E. It prints only variable names and
  presence state; secret values are never written to stdout.
#>
param([string]$EnvFile = ".env")

$required = @(
  "DATABASE_URL", "CORS_ORIGINS", "PUBLIC_APP_URL", "PUBLIC_WEB_URL",
  "BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_NAME", "BOOTSTRAP_ADMIN_PASSWORD",
  "BOOTSTRAP_PLANT_NAME", "BOOTSTRAP_TENANT_CODE", "BOOTSTRAP_TENANT_NAME"
)

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Write-Error "Missing environment file: $EnvFile"
  exit 1
}

$defined = @{}
Get-Content -LiteralPath $EnvFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$') { $defined[$matches[1]] = $true }
}

$missing = @($required | Where-Object { -not $defined.ContainsKey($_) })
if ($missing.Count) {
  Write-Host "Missing required .env keys: $($missing -join ', ')"
} else {
  Write-Host "Required .env keys: present"
}

try {
  docker info *> $null
  Write-Host "Docker daemon: reachable"
  $containers = @(docker ps -q)
  Write-Host "Running Docker containers: $($containers.Count)"
} catch {
  Write-Host "Docker daemon: unavailable"
  exit 1
}

if ($missing.Count) { exit 1 }
