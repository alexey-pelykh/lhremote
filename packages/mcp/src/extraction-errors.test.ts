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

  /**
   * The readiness gates put their per-adapter detect probe counts in the
   * error's `cause`: no adapter matched means LinkedIn changed its markup,
   * two matched means a hybrid page, exactly one means that adapter's field
   * selectors went stale.  An agent cannot open devtools to work that out,
   * so the counts have to reach the tool response text or the diagnosis is
   * lost at the process boundary.
   */
  it("carries the cause chain's detect probe counts into the response", () => {
    const text = textOf(
      new DOMVariantUnsupportedError("post-detail", ["sdui", "legacy"], {
        cause: new Error("detect probes — sdui: 0, legacy: 0"),
      }),
    );

    expect(text).toContain("register an adapter");
    expect(text).toContain("Caused by: detect probes — sdui: 0, legacy: 0");
  });

  /**
   * The search-results gate's cause is the one that names BOTH readings of a
   * zero match, because there the error class's own wording over-claims: a
   * search that legitimately matched nothing renders no cards, so no detect
   * anchor matches either.  Dropping this cause sends an agent to write an
   * adapter for a page that is working perfectly.
   *
   * The cause text is a SHAPE FIXTURE, shortened from the production string.
   * That wording is pinned where it is built, in the core package's
   * `search-posts.test.ts`; this asserts only that such a cause reaches the
   * tool response.
   */
  it("carries both readings of a search-results zero match", () => {
    const text = textOf(
      new DOMVariantUnsupportedError("search-results", ["sdui", "legacy"], {
        cause: new Error(
          "detect probes — sdui: 0, legacy: 0. No registered adapter's " +
            "detect anchor matched. That observation has TWO readings on the " +
            "search-results surface and the DOM cannot tell them apart: " +
            "LinkedIn changed its markup (register an adapter for the new " +
            "dialect), OR the search legitimately matched nothing.",
        ),
      }),
    );

    expect(text).toContain("TWO readings");
    expect(text).toContain("the search legitimately matched nothing");
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
