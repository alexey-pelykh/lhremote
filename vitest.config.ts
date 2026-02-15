// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
