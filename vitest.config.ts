// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Resolve relative to THIS file so the config behaves the same regardless of
// the cwd vitest is invoked from.  Each package runs a bare `vitest run` from
// its own directory and vitest resolves this config from the workspace root,
// leaving `root` at the package — so a path relative to the config would be
// looked up under `packages/<name>/` and silently miss.  Same reasoning as
// vitest.e2e.config.ts.
const CONFIG_DIR = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    // Tier-1 guard: fails any unit test that reaches the live network, so a
    // suite cannot depend on machine state again (#909, ADR-004).  Exempts
    // *.integration.test.ts from inside — see vitest.setup.ts.
    setupFiles: [`${CONFIG_DIR}vitest.setup.ts`],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.e2e.test.ts"],
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      // Package-relative on purpose.  Every package runs a bare `vitest run`
      // from its own directory, so `root` is `packages/<name>/` and this glob
      // resolves to that package's own sources.  It deliberately does NOT use
      // CONFIG_DIR the way `setupFiles` above does: an absolute repo-root glob
      // would pull every package's sources into every package's report, so
      // core's run would grade cli and mcp at 0%.  The previous
      // `packages/*/src/**/*.ts` resolved to `packages/<name>/packages/*/src/`
      // and matched nothing, which made `all: true` inert — only files a test
      // imported were graded, so an untested file could not lower the
      // thresholds, and lhremote (whose sole source file no test imports)
      // reported an empty table that passed the gate at 0% (#930).
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.e2e.test.ts",
        "**/*.d.ts",
        "**/testing/**",
      ],
      thresholds: {
        statements: 85,
        branches: 69,
        functions: 80,
        lines: 85,
      },
    },
  },
});
