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

# 2. Resolve the release version
PACKAGE_NAME="$(node -p "require('./package.json').name")"
CURRENT="$(node -p "require('./package.json').version")"
NEXT="$(node -e "const s=require('semver'); console.log(s.valid('$VERSION') || s.inc('$CURRENT','$VERSION') || '')")"
[[ -n "$NEXT" ]] || die "Invalid version/bump: $VERSION"

# 3. Validate before changing the version or creating a tag
log "Running release checks..."
bun run typecheck
bun run test:coverage
bun run build
bun run pack:check
ok "Release checks passed"

# 4. Verify auth against the registry that will publish this package
PUBLISH_REGISTRY="$(npm config get registry)"
[[ "$PUBLISH_REGISTRY" != "undefined" ]] || die "No npm publish registry is configured."
log "Verifying npm auth for ${PUBLISH_REGISTRY}..."
if ! NPM_USER="$(npm whoami --registry "$PUBLISH_REGISTRY" 2>/dev/null)"; then
  npm login --registry "$PUBLISH_REGISTRY" || die "npm login failed for ${PUBLISH_REGISTRY}."
  NPM_USER="$(npm whoami --registry "$PUBLISH_REGISTRY")" || die "npm authentication failed for ${PUBLISH_REGISTRY}."
fi
ok "Logged in as ${NPM_USER}"

# 5. Check version is available on the authenticated publish registry
log "Checking npm for ${PACKAGE_NAME}@${NEXT}..."
if NPM_VIEW_OUTPUT="$(npm view "${PACKAGE_NAME}@${NEXT}" version --registry "$PUBLISH_REGISTRY" 2>&1)"; then
  die "${PACKAGE_NAME}@${NEXT} already exists on npm."
elif [[ "$NPM_VIEW_OUTPUT" != *"code E404"* ]]; then
  printf '%s\n' "$NPM_VIEW_OUTPUT" >&2
  die "Could not verify ${PACKAGE_NAME}@${NEXT} on ${PUBLISH_REGISTRY}."
fi
ok "Version ${NEXT} is available"

# 6. Bump version
log "Bumping version (${VERSION})..."
npm version "$VERSION"
ok "Version bumped to ${NEXT}"

# 7. Publish
log "Publishing..."
npm publish
ok "Published ${PACKAGE_NAME}@${NEXT}"
