#!/usr/bin/env bash
set -euo pipefail

# ponytail: minimal release with nice output

VERSION="${1:?Usage: ./release.sh <patch|minor|major|x.y.z>}"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  GREEN=$'\033[0;32m' RED=$'\033[0;31m' CYAN=$'\033[0;36m' NC=$'\033[0m'
else
  GREEN="" RED="" CYAN="" NC=""
fi

ok()  { printf '%s\n' "${GREEN}✓ ${*}${NC}"; }
die() { printf '%s\n' "${RED}✗ ${*}${NC}" >&2; exit 1; }
log() { printf '%s\n' "${CYAN}→ ${*}${NC}"; }

# 1. No uncommitted changes
log "Checking working tree..."
[[ -z "$(git status --porcelain)" ]] || die "Uncommitted changes. Commit or stash first."
ok "Working tree clean"

# 2. Check version is available on npm
PACKAGE_NAME="$(node -p "require('./package.json').name")"
CURRENT="$(node -p "require('./package.json').version")"
NEXT="$(node -e "const s=require('semver'); console.log(s.valid('$VERSION') || s.inc('$CURRENT','$VERSION') || '')")"
[[ -n "$NEXT" ]] || die "Invalid version/bump: $VERSION"

log "Checking npm for ${PACKAGE_NAME}@${NEXT}..."
if npm view "${PACKAGE_NAME}@${NEXT}" version >/dev/null 2>&1; then
  die "${PACKAGE_NAME}@${NEXT} already exists on npm."
fi
ok "Version ${NEXT} is available"

# 3. npm login
log "Verifying npm auth..."
if npm whoami >/dev/null 2>&1; then
  ok "Logged in as $(npm whoami)"
else
  npm login
  ok "Logged in as $(npm whoami)"
fi

# 4. Bump version
log "Bumping version (${VERSION})..."
npm version "$VERSION"
ok "Version bumped to ${NEXT}"

# 5. Build & Publish
log "Building..."
bun run build
ok "Build complete"

log "Publishing..."
npm publish
ok "Published ${PACKAGE_NAME}@${NEXT}"
