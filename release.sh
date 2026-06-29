#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Release flow for the private development repo and the public npm/GitHub repo.
# Defaults are intentionally conservative; override with env vars only when needed.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
readonly PRIVATE_DIR="${PRIVATE_DIR:-$SCRIPT_DIR}"
readonly PUBLIC_DIR="${PUBLIC_DIR:-$PRIVATE_DIR/external/dscpublic}"
readonly DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

BUMP="patch"
DRY_RUN=0
SKIP_BUILD=0
SKIP_TESTS=0
SKIP_PUBLISH=0
YES=0

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  readonly GREEN=$'\033[0;32m'
  readonly YELLOW=$'\033[1;33m'
  readonly RED=$'\033[0;31m'
  readonly CYAN=$'\033[0;36m'
  readonly BOLD=$'\033[1m'
  readonly NC=$'\033[0m'
else
  readonly GREEN=""
  readonly YELLOW=""
  readonly RED=""
  readonly CYAN=""
  readonly BOLD=""
  readonly NC=""
fi

usage() {
  cat <<USAGE
Usage: ./release.sh [patch|minor|major|x.y.z] [options]

Options:
  --dry-run       Show the release steps without changing files or publishing
  --skip-build    Do not run bun run build
  --skip-tests    Do not run bun test
  --skip-publish  Bump/sync/commit/push, but do not publish to npm
  -y, --yes       Do not ask for confirmation
  -h, --help      Show this help

Environment:
  PRIVATE_DIR     Private repo path (default: script directory)
  PUBLIC_DIR      Public repo path (default: ./external/dscpublic)
  DEFAULT_BRANCH  Expected release branch (default: main)
  ALLOW_DIRTY=1   Allow tracked local changes before release
  ALLOW_PUBLIC_DIR_OUTSIDE=1
                  Allow PUBLIC_DIR outside ./external (disables deletion guard)
USAGE
}

log() {
  printf '%s\n' "${CYAN}${*}${NC}"
}

ok() {
  printf '%s\n' "${GREEN}${*}${NC}"
}

warn() {
  printf '%s\n' "${YELLOW}WARN: ${*}${NC}" >&2
}

die() {
  printf '%s\n' "${RED}ERROR: ${*}${NC}" >&2
  exit 1
}

on_error() {
  local exit_code=$?
  printf '%s\n' "${RED}Release failed at line ${BASH_LINENO[0]} (exit ${exit_code}).${NC}" >&2
  exit "$exit_code"
}
trap on_error ERR

run() {
  if (( DRY_RUN )); then
    local rendered
    printf -v rendered '%q ' "$@"
    printf '[dry-run] %s\n' "$rendered"
    return 0
  fi

  "$@"
}

run_in() {
  local dir=$1
  shift

  if (( DRY_RUN )); then
    local rendered
    printf -v rendered '%q ' "$@"
    printf '[dry-run] cd %q && %s\n' "$dir" "$rendered"
    return 0
  fi

  (cd "$dir" && "$@")
}

confirm() {
  (( YES || DRY_RUN )) && return 0

  local answer
  printf '%s' "${BOLD}Continue with release? [y/N] ${NC}"
  read -r answer
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" || "$answer" == "YES" ]]
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_file() {
  [[ -f "$1" ]] || die "Required file not found: $1"
}

require_dir() {
  [[ -d "$1" ]] || die "Required directory not found: $1"
}

git_has_tracked_changes() {
  local dir=$1
  ! git -C "$dir" diff --quiet || ! git -C "$dir" diff --cached --quiet
}

git_has_any_changes() {
  local dir=$1
  [[ -n "$(git -C "$dir" status --porcelain)" ]]
}

git_has_untracked_changes() {
  local dir=$1
  local line

  while IFS= read -r line; do
    [[ "$line" == '?? '* ]] && return 0
  done < <(git -C "$dir" status --porcelain --untracked-files=all --ignored=no)

  return 1
}

warn_untracked_changes() {
  local dir=$1
  local phase=$2

  if git_has_untracked_changes "$dir"; then
    warn "Untracked files exist in $dir during ${phase}; they will not be included unless explicitly copied."
  fi
}

require_git_repo() {
  local dir=$1
  git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
    die "Not a git repository: $dir"
}

require_release_branch() {
  local dir=$1
  local branch
  branch="$(git -C "$dir" branch --show-current)"

  [[ -n "$branch" ]] || die "Detached HEAD in $dir"
  if [[ "$branch" != "$DEFAULT_BRANCH" ]]; then
    warn "$dir is on branch '$branch' (expected '$DEFAULT_BRANCH')."
  fi
}

require_clean_tracked_tree() {
  local dir=$1

  if git_has_tracked_changes "$dir"; then
    if [[ "${ALLOW_DIRTY:-0}" == "1" ]]; then
      warn "Tracked changes found in $dir, continuing because ALLOW_DIRTY=1."
    else
      git -C "$dir" status --short
      die "Commit or stash tracked changes in $dir before releasing."
    fi
  fi

  warn_untracked_changes "$dir" "preflight"
}

read_package_field() {
  local dir=$1
  local field=$2
  node -e "const p=require(process.argv[1]); console.log(p[process.argv[2]] || '')" \
    "$dir/package.json" "$field"
}

compute_next_version() {
  local current=$1
  local bump=$2

  node -e "const semver=require('semver'); const current=process.argv[1]; const bump=process.argv[2]; console.log(semver.valid(bump) || semver.inc(current, bump) || '')" \
    "$current" "$bump"
}

update_public_package_version() {
  local version=$1
  local package_json="$PUBLIC_DIR/package.json"

  run node -e \
    "const fs=require('fs'); const file=process.argv[1]; const version=process.argv[2]; const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.version=version; fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');" \
    "$package_json" "$version"
}

copy_file() {
  local source=$1
  local target=$2

  require_file "$source"
  run cp "$source" "$target"
}

sync_public_repo() {
  local version=$1

  require_dir "$PRIVATE_DIR/dist"
  require_file "$PUBLIC_DIR/package.json"

  # Guard against a bad env var turning this into a dangerous deletion.
  [[ "$PUBLIC_DIR" == "$PRIVATE_DIR"/external/* || "${ALLOW_PUBLIC_DIR_OUTSIDE:-0}" == "1" ]] ||
    die "Refusing to sync: PUBLIC_DIR must live under $PRIVATE_DIR/external"

  run rm -rf "$PUBLIC_DIR/dist"
  run cp -R "$PRIVATE_DIR/dist" "$PUBLIC_DIR/dist"
  copy_file "$PRIVATE_DIR/README.md" "$PUBLIC_DIR/README.md"
  copy_file "$PRIVATE_DIR/LICENSE" "$PUBLIC_DIR/LICENSE"
  update_public_package_version "$version"
}

commit_if_needed() {
  local dir=$1
  local message=$2

  if (( DRY_RUN )); then
    run_in "$dir" git add .
    run_in "$dir" git commit -m "$message"
    return 0
  fi

  if git_has_any_changes "$dir"; then
    run_in "$dir" git add .
    run_in "$dir" git commit -m "$message"
  else
    ok "No changes to commit in $dir."
  fi
}

push_repo() {
  local dir=$1
  local branch
  branch="$(git -C "$dir" branch --show-current)"

  if git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    run_in "$dir" git push
  else
    run_in "$dir" git push -u origin "$branch"
  fi
}

version_exists_on_npm() {
  local package_name=$1
  local version=$2

  npm view "${package_name}@${version}" version >/dev/null 2>&1
}

require_npm_auth() {
  # Skip if publish won't happen anyway
  (( SKIP_PUBLISH )) && return 0

  if (( DRY_RUN )); then
    log "[dry-run] Would verify npm authentication before version bump."
    return 0
  fi

  if npm whoami >/dev/null 2>&1; then
    ok "npm authenticated as $(npm whoami)."
    return 0
  fi

  warn "Not logged in to npm. Running npm login..."
  npm login

  # Verify login succeeded
  npm whoami >/dev/null 2>&1 || die "npm login failed or was cancelled. Aborting before version bump."
  ok "npm authenticated as $(npm whoami)."
}

while (($#)); do
  case "$1" in
    patch|minor|major)
      BUMP="$1"
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    --skip-tests)
      SKIP_TESTS=1
      ;;
    --skip-publish)
      SKIP_PUBLISH=1
      ;;
    -y|--yes)
      YES=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
        BUMP="$1"
      else
        usage >&2
        die "Unknown argument: $1"
      fi
      ;;
  esac
  shift
done

require_command bun
require_command git
require_command node
require_command npm

require_dir "$PRIVATE_DIR"
require_dir "$PUBLIC_DIR"
require_file "$PRIVATE_DIR/package.json"
require_file "$PRIVATE_DIR/README.md"
require_file "$PRIVATE_DIR/LICENSE"
require_file "$PUBLIC_DIR/package.json"
require_git_repo "$PRIVATE_DIR"
require_git_repo "$PUBLIC_DIR"
require_release_branch "$PRIVATE_DIR"
require_release_branch "$PUBLIC_DIR"
require_clean_tracked_tree "$PRIVATE_DIR"
require_clean_tracked_tree "$PUBLIC_DIR"

PACKAGE_NAME="$(read_package_field "$PRIVATE_DIR" name)"
CURRENT_VERSION="$(read_package_field "$PRIVATE_DIR" version)"
TARGET_VERSION="$(compute_next_version "$CURRENT_VERSION" "$BUMP")"

[[ -n "$PACKAGE_NAME" ]] || die "package.json is missing name."
[[ -n "$CURRENT_VERSION" ]] || die "package.json is missing version."
[[ -n "$TARGET_VERSION" ]] || die "Invalid bump/version: $BUMP"

log "Release target"
printf '  package: %s\n' "$PACKAGE_NAME"
printf '  current: %s\n' "$CURRENT_VERSION"
printf '  target:  %s\n' "$TARGET_VERSION"
printf '  bump:    %s\n' "$BUMP"
printf '  private: %s\n' "$PRIVATE_DIR"
printf '  public:  %s\n' "$PUBLIC_DIR"

confirm || die "Release cancelled."

log "[1/9] Checking package metadata..."
run_in "$PRIVATE_DIR" npm pkg get name version >/dev/null

if (( SKIP_BUILD )); then
  warn "[2/9] Build skipped."
else
  log "[2/9] Building..."
  run_in "$PRIVATE_DIR" bun run build
fi

warn_untracked_changes "$PRIVATE_DIR" "post-build"

if (( SKIP_TESTS )); then
  warn "[3/9] Tests skipped."
else
  log "[3/9] Running tests..."
  run_in "$PRIVATE_DIR" bun test
fi

log "[4/9] Validating npm version..."
if (( DRY_RUN )); then
  ok "[dry-run] Would check that $PACKAGE_NAME@$TARGET_VERSION is available on npm."
elif (( SKIP_PUBLISH )); then
  warn "npm publish skipped by --skip-publish."
elif version_exists_on_npm "$PACKAGE_NAME" "$TARGET_VERSION"; then
  die "$PACKAGE_NAME@$TARGET_VERSION already exists on npm."
else
  ok "$PACKAGE_NAME@$TARGET_VERSION is available."
fi

log "[4b/9] Verifying npm authentication..."
require_npm_auth

log "[5/9] Bumping version ($BUMP)..."
if (( DRY_RUN )); then
  printf '[dry-run] npm version %q\n' "$BUMP"
  VERSION="$TARGET_VERSION"
else
  VERSION="$(run_in "$PRIVATE_DIR" npm version "$BUMP" | tail -n 1 | sed 's/^v//')"
  [[ "$VERSION" == "$TARGET_VERSION" ]] ||
    die "npm version produced $VERSION, expected $TARGET_VERSION."
fi

log "[5b] Building with new version..."
run_in "$PRIVATE_DIR" bun run build

if (( SKIP_PUBLISH )); then
  warn "[6/9] Publishing skipped."
else
  log "[6/9] Publishing to npm..."
  run_in "$PRIVATE_DIR" npm publish
  ok "Published v$VERSION."
fi

log "[7/9] Syncing dist and metadata to public repo..."
sync_public_repo "$VERSION"

warn_untracked_changes "$PUBLIC_DIR" "post-sync"

log "[8/9] Committing public repo changes..."
commit_if_needed "$PUBLIC_DIR" "v$VERSION"

log "[9/9] Pushing repositories and tags..."
push_repo "$PUBLIC_DIR"
push_repo "$PRIVATE_DIR"
run_in "$PRIVATE_DIR" git push --tags

if (( DRY_RUN )); then
  ok "Dry run for release v$VERSION done."
else
  ok "Release v$VERSION done."
fi
