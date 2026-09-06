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
      include: ["packages/*/src/**/*.ts"],
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
