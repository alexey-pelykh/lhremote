// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.e2e.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    fileParallelism: false,
  },
});
