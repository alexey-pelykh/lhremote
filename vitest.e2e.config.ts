// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Resolve relative to THIS file so the config behaves the same regardless of
// the cwd vitest is invoked from.  pnpm runs `vitest --config ../../vitest.e2e.config.ts`
// from each package directory; without this, vitest 4 doubled the path to
// `packages/e2e/packages/e2e/src/global-setup.ts` and crashed the whole suite.
const CONFIG_DIR = fileURLToPath(new URL(".", import.meta.url));

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
    globalSetup: [`${CONFIG_DIR}packages/e2e/src/global-setup.ts`],
    env: {
      // Opt in to timeout-failure diagnostics (screenshots, DOM probes)
      // for every E2E run.  Production callers (CLI, MCP) remain default-off
      // — see `captureProfileLoadFailure` in navigate-to-profile.ts and
      // ADR-007.
      LHREMOTE_CAPTURE_DIAGNOSTICS: "1",
    },
  },
});
