// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.e2e.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    fileParallelism: false,
    env: {
      // Opt in to timeout-failure diagnostics (screenshots, DOM probes)
      // for every E2E run.  Production callers (CLI, MCP) remain default-off
      // — see `captureProfileLoadFailure` in navigate-to-profile.ts and
      // ADR-007.
      LHREMOTE_CAPTURE_DIAGNOSTICS: "1",
    },
  },
});
