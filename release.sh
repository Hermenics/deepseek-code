#!/bin/bash
set -euo pipefail

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# Caminhos
PRIVATE_DIR="/home/marcelo/deepseek-code"
PUBLIC_DIR="/home/marcelo/deepseek-code/dscpublic"

# Bump type (default: patch)
BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo -e "${RED}Uso: ./scripts/release.sh [patch|minor|major]${NC}"
  exit 1
fi

echo -e "${CYAN}[1/7] Building...${NC}"
cd "$PRIVATE_DIR"
bun run build

echo -e "${CYAN}[2/7] Running tests...${NC}"
bun test

echo -e "${CYAN}[3/7] Bumping version ($BUMP)...${NC}"
npm version "$BUMP"

echo -e "${CYAN}[4/7] Publishing to npm...${NC}"
npm publish

VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}Published v${VERSION}${NC}"

echo -e "${CYAN}[5/7] Syncing dist to public repo...${NC}"
rm -rf "$PUBLIC_DIR/dist"
cp -r "$PRIVATE_DIR/dist" "$PUBLIC_DIR/dist"
cp "$PRIVATE_DIR/README.md" "$PUBLIC_DIR/README.md"
cp "$PRIVATE_DIR/LICENSE" "$PUBLIC_DIR/LICENSE"

echo -e "${CYAN}[6/7] Updating public package.json version...${NC}"
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$PUBLIC_DIR/package.json"

echo -e "${CYAN}[7/7] Committing and pushing...${NC}"
cd "$PUBLIC_DIR"
git add .
git commit -m "v${VERSION}"
git push

cd "$PRIVATE_DIR"
git push
git push --tags

echo -e "${GREEN}Release v${VERSION} done!${NC}"
