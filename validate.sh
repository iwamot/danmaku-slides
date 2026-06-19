#!/usr/bin/env bash
set -e

# mise
eval "$(mise activate bash)"
mise fmt
mise install

# TypeScript / npm
npm ci
npm audit signatures
npm run check:write
npm run typecheck
npm test
npm run build

# Shared lint tasks
mise run gha-lint
mise run shell-lint

# Check for uncommitted changes
git diff --exit-code
