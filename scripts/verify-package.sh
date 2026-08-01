#!/usr/bin/env bash
set -euo pipefail

pack_dir="$(mktemp -d)"
cleanup() { rm -rf "$pack_dir"; }
trap cleanup EXIT

pack_json="$(npm pack --ignore-scripts --json --pack-destination "$pack_dir" --cache "$pack_dir/npm-cache")"
pack_file="$(node -e 'const [entry] = JSON.parse(process.argv[1]); if (!entry?.filename) process.exit(1); process.stdout.write(entry.filename)' "$pack_json")"

install_dir="$pack_dir/install"
npm install --ignore-scripts --no-package-lock --prefix "$install_dir" "$pack_dir/$pack_file" --cache "$pack_dir/npm-cache"
bin="$install_dir/node_modules/.bin/deepseek"
expected_version="$(node -p "require('./package.json').version")"

[[ -x "$bin" ]] || { echo "Installed CLI binary is missing or not executable" >&2; exit 1; }
[[ "$("$bin" --version)" == "$expected_version" ]] || {
  echo "Packed CLI version does not match package.json" >&2
  exit 1
}

echo "Package smoke test passed: $pack_file"
