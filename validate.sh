#!/usr/bin/env bash
set -e

# mise
eval "$(mise activate bash)"
mise fmt
mise install

# TypeScript / npm
npm ci
npm audit signatures
npm audit

# Licenses. npm itself reports the license of every installed package, so the
# only thing left to write is the allow-list. Anything else — including SPDX
# expressions such as "(MIT OR Apache-2.0)" — fails, so a human looks at it.
# The query covers this package too, which also pins down its own declaration.
npm query '*' --json | node -e '
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    const allowed = new Set([
      "0BSD",
      "Apache-2.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "ISC",
      "MIT",
      "MPL-2.0",
    ]);
    const rejected = JSON.parse(raw).filter((pkg) => !allowed.has(pkg.license));
    for (const pkg of rejected) {
      console.error(pkg.name + "@" + pkg.version + ": " + (pkg.license ?? "(none)"));
    }
    if (rejected.length > 0) {
      process.exit(1);
    }
  });
'
npm run check:write
npm run typecheck
npm test
npm run build

# Shared lint tasks
mise run gha-lint
mise run shell-lint

# Check for uncommitted changes
git diff --exit-code
