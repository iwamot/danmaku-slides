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
      // SPDX identifiers
      "0BSD",
      "Apache-2.0",
      "BlueOak-1.0.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "CC0-1.0",
      "CNRI-Python",
      "ISC",
      "MIT",
      "MIT-0",
      "MIT-CMU",
      "MPL-2.0",
      "PSF-2.0",
      "Python-2.0",
      "Zlib",
      // SPDX expressions and free-form license fields
      "(AFL-2.1 OR BSD-3-Clause)",
      "(BSD-2-Clause OR MIT OR Apache-2.0)",
      "MIT OR Apache",
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
