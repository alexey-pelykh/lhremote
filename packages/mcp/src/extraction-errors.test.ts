// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionFailedError,
} from "@lhremote/core";

import { mcpCatchAll } from "./helpers.js";

/**
 * An agent consuming an MCP tool is the least able party to diagnose a DOM
 * variant problem: it cannot open devtools, read the page, or inspect a
 * selector. So the diagnostic detail has to survive all the way to the tool
 * response text — asserting it on the error object alone would not prove
 * that.
 */
describe("extraction errors surfaced through MCP", () => {
  function textOf(error: unknown): string {
    const result = mcpCatchAll(error, "Failed to get post");
    expect(result.isError).toBe(true);
    return result.content.map((c) => c.text).join("\n");
  }

  it("ExtractionFailedError reaches the tool response naming variant and field", () => {
    const text = textOf(
      new ExtractionFailedError({
        surface: "post-detail",
        variant: "legacy",
        field: "comments",
        corroborator: "commentCount=41",
      }),
    );

    expect(text).toContain("legacy");
    expect(text).toContain("comments");
    expect(text).toContain("commentCount=41");
    expect(text).toContain("repair the selectors");
  });

  it("DOMVariantUnsupportedError reaches the tool response naming the surface", () => {
    const text = textOf(
      new DOMVariantUnsupportedError("post-detail", ["sdui", "legacy"]),
    );

    expect(text).toContain("post-detail");
    expect(text).toContain("sdui, legacy");
    expect(text).toContain("register an adapter");
  });

  it("DOMVariantAmbiguousError reaches the tool response naming every match", () => {
    const text = textOf(new DOMVariantAmbiguousError("feed", ["sdui", "legacy"]));

    expect(text).toContain("sdui, legacy");
    expect(text).toContain("transitional or hybrid");
  });

  it("is flagged as an error rather than returned as success", () => {
    const result = mcpCatchAll(
      new DOMVariantUnsupportedError("post-detail", []),
      "Failed to get post",
    );

    // The whole defect this migration fixes was returning HTTP-success on a
    // failed extraction. isError must be true.
    expect(result.isError).toBe(true);
  });
});
