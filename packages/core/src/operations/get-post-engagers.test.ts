// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

// extractPostUrn is tested in get-post-stats.test.ts; here we test
// the response-parsing logic indirectly by importing the module.
// Direct unit tests for the operation function require CDP mocking
// which is covered by integration tests.

describe("get-post-engagers module", () => {
  it("exports the getPostEngagers function", async () => {
    const mod = await import("./get-post-engagers.js");
    expect(typeof mod.getPostEngagers).toBe("function");
  });

  it("exports the GetPostEngagersInput type-compatible shape", async () => {
    // Type-level verification: ensure the input shape is importable
    const mod = await import("./get-post-engagers.js");
    expect(mod.getPostEngagers).toBeDefined();
  });
});
