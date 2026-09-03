// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import { formatVariantProbes } from "../linkedin/dom-variant.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
} from "../services/errors.js";
import { errorMessage } from "./error-message.js";

describe("errorMessage", () => {
  it("should extract message from Error instances", () => {
    expect(errorMessage(new Error("something failed"))).toBe(
      "something failed",
    );
  });

  it("should extract message from Error subclasses", () => {
    expect(errorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  it("should convert strings via String()", () => {
    expect(errorMessage("plain string")).toBe("plain string");
  });

  it("should convert numbers via String()", () => {
    expect(errorMessage(42)).toBe("42");
  });

  it("should convert null via String()", () => {
    expect(errorMessage(null)).toBe("null");
  });

  it("should convert undefined via String()", () => {
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("should convert objects via String()", () => {
    expect(errorMessage({ toString: () => "custom" })).toBe("custom");
  });
});

/**
 * The `cause` chain is where the DOM variant-tolerance work put its
 * diagnosis, and this function is the only hop between that chain and what
 * a CLI user or an MCP agent reads.  These pin the rendering contract.
 */
describe("errorMessage cause chain", () => {
  it("renders a cause on its own Caused by line", () => {
    const error = new Error("outer failed", {
      cause: new Error("socket hang up"),
    });

    expect(errorMessage(error)).toBe(
      "outer failed\nCaused by: socket hang up",
    );
  });

  it("renders a nested chain outermost first", () => {
    const error = new Error("A", {
      cause: new Error("B", { cause: new Error("C") }),
    });

    expect(errorMessage(error)).toBe("A\nCaused by: B\nCaused by: C");
  });

  it("treats an absent, undefined or null cause as no cause", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(new Error("boom", { cause: undefined }))).toBe("boom");
    expect(errorMessage(new Error("boom", { cause: null }))).toBe("boom");
  });

  it("skips a cause with no text of its own", () => {
    expect(errorMessage(new Error("boom", { cause: new Error("") }))).toBe(
      "boom",
    );
    expect(errorMessage(new Error("boom", { cause: new Error("   ") }))).toBe(
      "boom",
    );
  });

  it("renders a non-Error cause via String() and stops there", () => {
    const error = new Error("outer", { cause: "raw string cause" });

    expect(errorMessage(error)).toBe("outer\nCaused by: raw string cause");
  });

  it("does not leave a blank leading line when the head has no message", () => {
    const error = new Error("", { cause: new Error("the real reason") });

    expect(errorMessage(error)).toBe("Caused by: the real reason");
  });

  /**
   * The prevailing wrap idiom in this codebase interpolates the cause's
   * message into the wrapper's own and *also* passes `{ cause }`, so a naive
   * walk would print it twice.
   */
  it("does not repeat a cause the wrapper already interpolated", () => {
    const inner = new Error("socket hang up");
    const outer = new Error(`Failed to create campaign: ${inner.message}`, {
      cause: inner,
    });

    expect(errorMessage(outer)).toBe("Failed to create campaign: socket hang up");
  });

  it("ends the walk on a cycle instead of looping", () => {
    const a = new Error("A");
    const b = new Error("B");
    a.cause = b;
    b.cause = a;

    expect(errorMessage(a)).toBe("A\nCaused by: B");
  });

  it("stops after five causes and says that it did", () => {
    let cause = new Error("level-7");
    for (const level of [6, 5, 4, 3, 2, 1]) {
      cause = new Error(`level-${String(level)}`, { cause });
    }
    const rendered = errorMessage(new Error("head", { cause }));

    for (const level of [1, 2, 3, 4, 5]) {
      expect(rendered).toContain(`Caused by: level-${String(level)}`);
    }
    expect(rendered).not.toContain("level-6");
    expect(rendered).not.toContain("level-7");
    expect(rendered).toContain("further causes omitted");
  });

  /**
   * The budget is spent on what an operator SAW.  A link the rules skip is
   * not text they read, so charging it against the bound would drop a real
   * cause and then claim five had been shown.
   */
  it("does not spend the render budget on a skipped link", () => {
    let cause = new Error("level-6");
    for (const level of [5, 4, 3, 2]) {
      cause = new Error(`level-${String(level)}`, { cause });
    }
    // level-1 is skipped: the head already contains its text.
    const skipped = new Error("level-1", { cause });
    const rendered = errorMessage(
      new Error(`Failed to do the thing: ${skipped.message}`, {
        cause: skipped,
      }),
    );

    for (const level of [2, 3, 4, 5, 6]) {
      expect(rendered).toContain(`Caused by: level-${String(level)}`);
    }
    expect(rendered).not.toContain("Caused by: level-1");
  });

  /**
   * Bounds the WORK, not the output: a chain whose links are all skipped
   * renders nothing and would otherwise be walked to its end.
   */
  it("stops following links long before an unbounded chain ends", () => {
    let cause = new Error("repeated");
    for (let i = 0; i < 200; i++) {
      cause = new Error("repeated", { cause });
    }
    const rendered = errorMessage(new Error("head", { cause }));

    expect(rendered).toBe(
      `head\nCaused by: repeated\n${"Caused by: … (further causes omitted)"}`,
    );
  });

  it("elides a cause longer than the per-cause bound", () => {
    const long = "x".repeat(1500);
    const rendered = errorMessage(new Error("head", { cause: new Error(long) }));

    expect(rendered).toBe(`head\nCaused by: ${"x".repeat(1000)}…`);
  });

  it("renders a cause up to the per-cause bound in full", () => {
    const exact = "y".repeat(1000);
    const rendered = errorMessage(
      new Error("head", { cause: new Error(exact) }),
    );

    expect(rendered).toBe(`head\nCaused by: ${exact}`);
    expect(rendered).not.toContain("…");
  });

  /**
   * `length` counts UTF-16 code units, so a blind slice can keep the leading
   * half of a surrogate pair and reach the operator as a replacement glyph.
   */
  it("does not cut a surrogate pair in half when eliding", () => {
    const rendered = errorMessage(
      new Error("head", { cause: new Error("x".repeat(999) + "\u{1F600}") }),
    );

    expect(rendered).toBe(`head\nCaused by: ${"x".repeat(999)}…`);
    // The property under test, stated directly: no unpaired surrogate. A
    // paired one is fine and must not be flagged.
    const loneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(rendered)).toBe(false);
  });

  /**
   * This runs inside a catch block at the process boundary — the CLI handler
   * and the MCP catch-all both call it while handling a failure.  A throw
   * here destroys the report instead of writing it.
   */
  it("never throws on a cause it cannot render", () => {
    expect(errorMessage(new Error("head", { cause: Object.create(null) }))).toBe(
      "head",
    );

    const throwingToString = {
      toString() {
        throw new Error("boom-tostring");
      },
    };
    expect(errorMessage(new Error("head", { cause: throwingToString }))).toBe(
      "head",
    );

    const throwingGetter = new Error("head");
    Object.defineProperty(throwingGetter, "cause", {
      get() {
        throw new Error("boom-getter");
      },
    });
    expect(errorMessage(throwingGetter)).toBe("head");
  });

  it("keeps the causes it did render when a later link is unrenderable", () => {
    const unrenderable = new Error("deep");
    Object.defineProperty(unrenderable, "cause", {
      get() {
        throw new Error("boom-getter");
      },
    });

    expect(errorMessage(new Error("head", { cause: unrenderable }))).toBe(
      "head\nCaused by: deep",
    );
  });

  /**
   * A trailing newline on the head was invisible while the head was the whole
   * output; it shows up as a blank line once a cause follows it.
   */
  it("normalizes the head on the same terms as a cause", () => {
    expect(
      errorMessage(new Error("boot failed\n", { cause: new Error("ENOENT") })),
    ).toBe("boot failed\nCaused by: ENOENT");

    expect(errorMessage(new Error("   ", { cause: new Error("x") }))).toBe(
      "Caused by: x",
    );
  });

  /**
   * The shape production actually builds: the wrapper interpolates the
   * *rendered* chain, not the bare message, so every link of the inner chain
   * is already present in the head.  The synthetic single-link case above
   * cannot catch a regression here.
   */
  it("does not repeat a chain the wrapper rendered into its own message", () => {
    const root = new Error("connect ECONNREFUSED 127.0.0.1:9222");
    const inner = new Error("Failed to discover CDP targets", { cause: root });
    const wrapper = new Error(
      `Failed to create campaign: ${errorMessage(inner)}`,
      { cause: inner },
    );

    expect(errorMessage(wrapper)).toBe(
      "Failed to create campaign: Failed to discover CDP targets\n" +
        "Caused by: connect ECONNREFUSED 127.0.0.1:9222",
    );
  });

  /**
   * Comparing the elided text against an un-elided head would stop matching
   * exactly when the cause is long — which is when a duplicate costs most.
   */
  it("does not repeat a cause longer than the per-cause bound", () => {
    const inner = new Error("z".repeat(1200));
    const wrapper = new Error(`Failed: ${inner.message}`, { cause: inner });

    expect(errorMessage(wrapper)).toBe(`Failed: ${"z".repeat(1200)}`);
  });

  /**
   * A link repeating a distant ancestor is the same condition observed at two
   * layers, which is information; only an adjacent repeat is noise.
   */
  it("keeps a cause that repeats an ancestor further up the chain", () => {
    const deep = new Error("ECONNREFUSED 127.0.0.1:9222");
    const mid = new Error("CDP connect failed", { cause: deep });
    const head = new Error("ECONNREFUSED 127.0.0.1:9222", { cause: mid });

    expect(errorMessage(head)).toBe(
      "ECONNREFUSED 127.0.0.1:9222\n" +
        "Caused by: CDP connect failed\n" +
        "Caused by: ECONNREFUSED 127.0.0.1:9222",
    );
  });
});

/**
 * The reason this function walks the chain at all: the readiness gates put
 * their per-adapter detect probe counts in `cause`, and those counts are the
 * reading that tells an operator which repair to make.  Asserting on the
 * error object would not prove they survive to what an operator reads.
 *
 * The probe text is built with the gates' own formatter rather than a
 * look-alike literal, so a change to that format fails here too.
 */
describe("errorMessage on the errors the readiness gates raise", () => {
  const detection = {
    matched: [] as readonly string[],
    probes: { sdui: 0, legacy: 0 },
  };

  it("carries detect probe counts through DOMVariantUnsupportedError", () => {
    const rendered = errorMessage(
      new DOMVariantUnsupportedError("post-detail", ["sdui", "legacy"], {
        cause: new Error(`detect probes — ${formatVariantProbes(detection)}`),
      }),
    );

    expect(rendered).toContain("register an adapter");
    expect(rendered).toContain("Caused by: detect probes — sdui: 0, legacy: 0");
  });

  it("carries detect probe counts through DOMVariantAmbiguousError", () => {
    const both = { matched: ["sdui", "legacy"], probes: { sdui: 1, legacy: 1 } };
    const rendered = errorMessage(
      new DOMVariantAmbiguousError("post-detail", both.matched, {
        cause: new Error(`detect probes — ${formatVariantProbes(both)}`),
      }),
    );

    expect(rendered).toContain("tighten the detect anchors");
    expect(rendered).toContain("Caused by: detect probes — sdui: 1, legacy: 1");
  });

  /**
   * The search-results gate's cause is the one that names BOTH readings of a
   * zero match, because on that surface the error class's own wording
   * over-claims: a search that legitimately matched nothing also matches no
   * detect anchor.  Losing this cause sends an operator to write an adapter
   * for a page that is working perfectly.
   *
   * The cause text here is a SHAPE FIXTURE — a shortened stand-in for the
   * production string, long enough to exercise a multi-sentence cause.  The
   * production wording is pinned where it is built, by the assertions on
   * `zeroMatchCause` in `../operations/search-posts.test.ts`; this asserts
   * only that a cause of that shape survives to the rendered output.
   */
  it("carries both readings of a search-results zero match", () => {
    const rendered = errorMessage(
      new DOMVariantUnsupportedError("search-results", ["sdui", "legacy"], {
        cause: new Error(
          `detect probes — ${formatVariantProbes(detection)}. ` +
            "No registered adapter's detect anchor matched. That observation " +
            "has TWO readings on the search-results surface and the DOM " +
            "cannot tell them apart: LinkedIn changed its markup (register " +
            "an adapter for the new dialect), OR the search legitimately " +
            "matched nothing.",
        ),
      }),
    );

    expect(rendered).toContain("TWO readings");
    expect(rendered).toContain("the search legitimately matched nothing");
    expect(rendered).toContain("sdui: 0, legacy: 0");
  });
});
