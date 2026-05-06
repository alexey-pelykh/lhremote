// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.e2e.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    fileParallelism: false,
    // Suite-level CW health gate — see packages/e2e/src/global-setup.ts (#783).
    // Aborts the whole suite up front if LinkedIn ContentWindow can't enter
    // LoggedInState, instead of cascading through 60+ tests with the same
    // root cause.
    globalSetup: ["./packages/e2e/src/global-setup.ts"],
    env: {
      // Opt in to timeout-failure diagnostics (screenshots, DOM probes)
      // for every E2E run.  Production callers (CLI, MCP) remain default-off
      // — see `captureProfileLoadFailure` in navigate-to-profile.ts and
      // ADR-007.
      LHREMOTE_CAPTURE_DIAGNOSTICS: "1",
    },
  },
});
