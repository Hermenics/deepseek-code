#!/usr/bin/env bash

set -euo pipefail

PACKAGE="@hermenics/deepseek-code"
TARGET="${1:-latest}"

usage() {
  echo "Usage: $0 [stable|latest|VERSION]" >&2
}

if [[ $# -gt 1 ]]; then
  usage
  exit 1
fi

if [[ "$TARGET" != "stable" && "$TARGET" != "latest" && ! "$TARGET" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[^[:space:]]+)?$ ]]; then
  usage
  exit 1
fi

if [[ "$(id -u)" -eq 0 && -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" && -z "${DEEPSEEK_INSTALL_ALLOW_SUDO:-}" ]]; then
  echo "Error: do not run this installer with sudo." >&2
  echo "DeepSeek Code installs through your user-level package manager." >&2
  echo "Run the same command without sudo, or set DEEPSEEK_INSTALL_ALLOW_SUDO=1 intentionally." >&2
  exit 1
fi

has_supported_bun() {
  local version
  if ! command -v bun >/dev/null 2>&1 || ! version="$(bun --version 2>/dev/null)"; then
    return 1
  fi
  if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+) ]]; then
    return 1
  fi
  (( BASH_REMATCH[1] > 1 || (BASH_REMATCH[1] == 1 && BASH_REMATCH[2] >= 1) ))
}

PACKAGE_MANAGER="${DEEPSEEK_INSTALL_PACKAGE_MANAGER:-}"
if [[ -z "$PACKAGE_MANAGER" ]]; then
  if command -v npm >/dev/null 2>&1; then
    PACKAGE_MANAGER="npm"
  elif command -v bun >/dev/null 2>&1; then
    PACKAGE_MANAGER="bun"
  else
    echo "DeepSeek Code requires npm or Bun to install, plus Bun 1.1+ to run." >&2
    exit 1
  fi
fi

if [[ "$PACKAGE_MANAGER" != "npm" && "$PACKAGE_MANAGER" != "bun" ]]; then
  echo "DEEPSEEK_INSTALL_PACKAGE_MANAGER must be npm or bun." >&2
  exit 1
fi

if ! command -v "$PACKAGE_MANAGER" >/dev/null 2>&1; then
  echo "$PACKAGE_MANAGER is not installed or is not on PATH." >&2
  exit 1
fi

if [[ "$PACKAGE_MANAGER" == "bun" ]] && ! has_supported_bun; then
  echo "DeepSeek Code requires Bun 1.1+ to install with Bun. Install or upgrade it: https://bun.sh" >&2
  exit 1
fi

# npm has no separate stable channel for this package, so stable follows latest.
if [[ "$TARGET" == "stable" || "$TARGET" == "latest" ]]; then
  PACKAGE_SPEC="$PACKAGE@latest"
else
  PACKAGE_SPEC="$PACKAGE@$TARGET"
fi

echo "Installing $PACKAGE_SPEC with $PACKAGE_MANAGER..."
if [[ "$PACKAGE_MANAGER" == "npm" ]]; then
  npm install --global --no-audit --no-fund "$PACKAGE_SPEC"
else
  bun add --global "$PACKAGE_SPEC"
fi

echo
if has_supported_bun; then
  echo "✓ DeepSeek Code installed successfully."
  echo "Run: deepseek"
else
  echo "✓ DeepSeek Code was installed. It requires Bun 1.1+ to run."
  echo "Install or upgrade Bun: https://bun.sh"
fi
