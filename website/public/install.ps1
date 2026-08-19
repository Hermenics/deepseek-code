param(
  [Parameter(Position = 0)]
  [string]$Target = 'latest'
)

$ErrorActionPreference = 'Stop'
$Package = '@hermenics/deepseek-code'

function Show-Usage {
  Write-Error 'Usage: .\install.ps1 [stable|latest|VERSION]'
}

if ($Target -notmatch '^(stable|latest|[0-9]+\.[0-9]+\.[0-9]+(-[^\s]+)?)$') {
  Show-Usage
  exit 1
}

function Test-SupportedBun {
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { return $false }
  try {
    $version = (& bun --version 2>$null | Select-Object -First 1).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^(?<major>[0-9]+)\.(?<minor>[0-9]+)') { return $false }
    return ([int]$Matches.major -gt 1) -or ([int]$Matches.major -eq 1 -and [int]$Matches.minor -ge 1)
  } catch {
    return $false
  }
}

$PackageManager = $env:DEEPSEEK_INSTALL_PACKAGE_MANAGER
if ([string]::IsNullOrWhiteSpace($PackageManager)) {
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    $PackageManager = 'npm'
  } elseif (Get-Command bun -ErrorAction SilentlyContinue) {
    $PackageManager = 'bun'
  } else {
    Write-Error 'DeepSeek Code requires npm or Bun to install, plus Bun 1.1+ to run.'
    exit 1
  }
}

if ($PackageManager -notin @('npm', 'bun')) {
  Write-Error 'DEEPSEEK_INSTALL_PACKAGE_MANAGER must be npm or bun.'
  exit 1
}

if (-not (Get-Command $PackageManager -ErrorAction SilentlyContinue)) {
  Write-Error "$PackageManager is not installed or is not on PATH."
  exit 1
}

if ($PackageManager -eq 'bun' -and -not (Test-SupportedBun)) {
  Write-Error 'DeepSeek Code requires Bun 1.1+ to install with Bun. Install or upgrade it: https://bun.sh'
  exit 1
}

if ($Target -eq 'stable' -or $Target -eq 'latest') {
  $PackageSpec = "$Package@latest"
} else {
  $PackageSpec = "$Package@$Target"
}

Write-Host "Installing $PackageSpec with $PackageManager..."
if ($PackageManager -eq 'npm') {
  & npm install --global --no-audit --no-fund $PackageSpec
} else {
  & bun add --global $PackageSpec
}

Write-Host ''
if (Test-SupportedBun) {
  Write-Host '✓ DeepSeek Code installed successfully.'
  Write-Host 'Run: deepseek'
} else {
  Write-Host '✓ DeepSeek Code was installed. It requires Bun 1.1+ to run.'
  Write-Host 'Install or upgrade Bun: https://bun.sh'
}
