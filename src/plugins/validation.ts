// Shared validation patterns for plugin names and repo slugs.
// Single source of truth used by both the command parser and installer.
export const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
export const PLUGIN_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
