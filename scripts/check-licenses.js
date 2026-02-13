#!/usr/bin/env node

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

/**
 * Validates that all production dependency licenses are compatible with AGPL-3.0-only.
 *
 * Uses `pnpm licenses list --prod --json` which natively handles pnpm workspaces
 * and excludes workspace packages.
 *
 * Exit codes:
 *   0 — all licenses are on the allow-list
 *   1 — one or more licenses are not on the allow-list
 */

import { execSync } from "node:child_process";

const ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "BlueOak-1.0.0",
  "Unlicense",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
]);

const output = execSync("pnpm licenses list --prod --json", {
  encoding: "utf-8",
});
const licenseMap = JSON.parse(output);

const violations = [];
for (const [license, packages] of Object.entries(licenseMap)) {
  if (!ALLOWED_LICENSES.has(license)) {
    for (const pkg of packages) {
      violations.push({ name: pkg.name, version: pkg.versions.join(", "), license });
    }
  }
}

if (violations.length > 0) {
  console.error("License compatibility check FAILED.\n");
  console.error("The following production dependencies have licenses not on the allow-list:\n");
  for (const v of violations) {
    console.error(`  ${v.name}@${v.version} — ${v.license}`);
  }
  console.error(`\nAllowed licenses: ${[...ALLOWED_LICENSES].join(", ")}`);
  console.error(
    "\nIf a license is compatible with AGPL-3.0-only, add it to ALLOWED_LICENSES in scripts/check-licenses.js.",
  );
  process.exit(1);
} else {
  const total = Object.values(licenseMap).reduce((sum, pkgs) => sum + pkgs.length, 0);
  console.log(
    `License check passed: ${total} production dependencies, all using allowed licenses.`,
  );
  console.log(`Licenses found: ${Object.keys(licenseMap).sort().join(", ")}`);
}
