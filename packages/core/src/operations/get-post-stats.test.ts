// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
} from "../services/errors.js";
import {
  adaptersFor,
  buildPostDetailExtractionSource,
} from "../linkedin/dom-variant.js";
import {
  extractPostUrn,
  getPostStats,
} from "./get-post-stats.js";

describe("extractPostUrn", () => {
  it("extracts URN from /feed/update/ URL with activity URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL with ugcPost URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678/",
      ),
    ).toBe("urn:li:ugcPost:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL with share URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678/",
      ),
    ).toBe("urn:li:share:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL without trailing slash", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("extracts activity URN from /posts/ URL", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/posts/johndoe_activity-7123456789012345678-abcd/",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("passes through raw URN input", () => {
    expect(extractPostUrn("urn:li:activity:7123456789012345678")).toBe(
      "urn:li:activity:7123456789012345678",
    );
  });

  it("passes through raw ugcPost URN", () => {
    expect(extractPostUrn("urn:li:ugcPost:7123456789012345678")).toBe(
      "urn:li:ugcPost:7123456789012345678",
    );
  });

  it("throws on unrecognised input", () => {
    expect(() => extractPostUrn("https://example.com/foo")).toThrow(
      "Cannot extract post URN from",
    );
  });

  it("throws on empty input", () => {
    expect(() => extractPostUrn("")).toThrow("Cannot extract post URN from");
  });
});

describe("getPostStats", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  function setupMocks(opts?: {
    postStats?: unknown;
    readySequence?: boolean[];
  }) {
    const { readySequence = [true] } = opts ?? {};

    // `undefined` is a MEANINGFUL value for `postStats`, not an absent one:
    // `CDPClient.evaluate` ends `return result.result?.value as T` and so
    // resolves `undefined` whenever CDP omits `result`.  Presence of the key
    // therefore decides, not its value — a `= default` destructure cannot
    // express that, because it fires on an explicitly-passed `undefined` too
    // and would silently substitute the happy record for the case under test.
    const postStats =
      opts && "postStats" in opts
        ? opts.postStats
        : { reactionCount: 42, commentCount: 5, shareCount: 3 };

    vi.mocked(discoverTargets).mockResolvedValue([
      {
        id: "target-1",
        type: "page",
        title: "LinkedIn",
        url: "https://www.linkedin.com/feed/",
        description: "",
        devtoolsFrontendUrl: "",
      },
    ]);

    const disconnect = vi.fn();
    const navigate = vi.fn().mockResolvedValue(undefined);

    // Build evaluate mock call sequence:
    // 1. readiness checks (boolean)
    // 2. post stats scrape (object)
    const evaluateMock = vi.fn();
    for (const ready of readySequence) {
      evaluateMock.mockResolvedValueOnce(ready);
    }
    evaluateMock.mockResolvedValueOnce(postStats);

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate,
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as CDPClient;
    });

    return { evaluateMock, disconnect, navigate };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      getPostStats({
        postUrl: POST_URL,
        cdpPort: CDP_PORT,
        cdpHost: "192.168.1.1",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow("No LinkedIn page found in LinkedHelper");
  });

  it("navigates to post detail URL and extracts stats from DOM", async () => {
    const { navigate } = setupMocks();

    const result = await getPostStats({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/",
    );

    expect(result.stats).toEqual({
      postUrn: "urn:li:activity:1234567890",
      reactionCount: 42,
      reactionsByType: [],
      commentCount: 5,
      shareCount: 3,
    });
  });

  it("returns empty reactionsByType (DOM has no breakdown)", async () => {
    setupMocks({
      postStats: { reactionCount: 100, commentCount: 10, shareCount: 5 },
    });

    const result = await getPostStats({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.stats.reactionsByType).toEqual([]);
    expect(result.stats.reactionCount).toBe(100);
  });

  it("handles zero counts gracefully", async () => {
    setupMocks({
      postStats: { reactionCount: 0, commentCount: 0, shareCount: 0 },
    });

    const result = await getPostStats({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.stats).toEqual({
      postUrn: "urn:li:activity:1234567890",
      reactionCount: 0,
      reactionsByType: [],
      commentCount: 0,
      shareCount: 0,
    });
  });

  it("refuses when no adapter claimed the page", async () => {
    // `null` is the extraction script's "nothing read this page" outcome:
    // zero adapters claimed it, or the claiming one could not resolve its own
    // scope.  Refusing is ADR-008's empty-vs-error contract — the alternative
    // the whole-page regex took was to return zeroes, which is a claim about
    // the post's engagement that nothing observed (#857).
    setupMocks({ postStats: null });

    const rejection = getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    // Class AND arguments, on one settled rejection.  The two branches pass
    // DIFFERENT string arrays — this one every registered variant, the
    // ambiguous one only the variants that actually claimed the page — and
    // they are interchangeable to the type checker, so the class alone does
    // not pin which list the operator is shown.
    await expect(rejection).rejects.toThrow(DOMVariantUnsupportedError);
    await expect(rejection).rejects.toThrow(
      /No DOM adapter matched the post-detail page \(tried: sdui, legacy\)/,
    );
  });

  it("refuses when two adapters claimed the page", async () => {
    // A transitional or hybrid dialect.  Counters assembled out of two
    // dialects are wrong in a way nothing downstream can detect, so the
    // outcome is reported rather than resolved — the same posture `get-post`
    // takes against the same script.
    setupMocks({ postStats: { ambiguousVariants: ["sdui", "legacy"] } });

    const rejection = getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    await expect(rejection).rejects.toThrow(DOMVariantAmbiguousError);
    // The variants the SCRIPT reported, not the registry's whole list: an
    // operator told every registered dialect matched would tighten the wrong
    // detect anchors.
    await expect(rejection).rejects.toThrow(
      /Multiple DOM adapters matched the post-detail page \(sdui, legacy\)/,
    );
  });

  it("refuses when the page evaluation yields nothing at all", async () => {
    // `CDPClient.evaluate` ends `return result.result?.value as T`, so it
    // resolves `undefined` — not `null` — whenever CDP omits `result`.  The
    // refusal is written as a falsiness test and therefore covers both; this
    // pins that, so a later tightening to `raw === null` cannot let an
    // `undefined` fall through to the ambiguity check, which would dereference
    // it and replace a typed refusal with a bare `TypeError`.
    setupMocks({ postStats: undefined });

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);
  });

  it("waits for post to load with polling", async () => {
    const { evaluateMock } = setupMocks({
      readySequence: [false, false, true],
    });

    await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    // 3 readiness checks + 1 stats scrape = 4
    expect(evaluateMock).toHaveBeenCalledTimes(4);
  });

  it("disconnects CDP client after successful operation", async () => {
    const { disconnect } = setupMocks();

    await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
    const { disconnect } = setupMocks({ postStats: null });

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    expect(disconnect).toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // #857 — the counts are read through the selected adapter, not off the page
  //
  // This tier cannot run a DOM, so it does not re-grade what the read returns.
  // What it pins is WHICH script performs the read, and that is the whole of
  // the fix: the script below is already graded against a real browser in
  // `dom-variant.integration.test.ts` for each of the three ways the
  // whole-page read was wrong — the join ("2" beside "41 comments" flattening
  // to "241 comments"), the label (a reaction count whose words live only on
  // the control's `aria-label`), and the scope (a "<N> comments" run from
  // somewhere else on the page).  Binding this operation to that string is
  // what transfers all three; re-asserting the values here would duplicate
  // that oracle against a stand-in DOM it exists to distrust.
  // ─────────────────────────────────────────────────────────────────────────

  /** The script the operation evaluates after readiness has gone green. */
  function extractionScript(evaluateMock: ReturnType<typeof vi.fn>): string {
    return evaluateMock.mock.calls.at(-1)?.[0] as string;
  }

  it("evaluates the shared post-detail extraction script", async () => {
    const { evaluateMock } = setupMocks();

    await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(extractionScript(evaluateMock)).toBe(
      buildPostDetailExtractionSource(adaptersFor("post-detail")),
    );
  });

  it("never reads the counts off the whole page body", async () => {
    // The defect itself, stated independently of the builder above so that it
    // survives a builder rename: no scrape this operation runs may flatten the
    // document into one string.  Asserting `241` anywhere would bake the
    // defect into the oracle and make the next fix look like the regression.
    //
    // Keyed on `document.body` rather than on the one spelling the defect
    // happened to use.  This repo flattens a page in four other places as
    // `document.body.innerText` (`search-posts.ts`, `wait-for-post-load.ts`,
    // `wait-for-reactions-modal.ts`, `navigate-to-profile.ts`), so the most
    // likely accidental reintroduction here is a copy-paste that a
    // `textContent`-only assertion would wave straight through.
    const { evaluateMock } = setupMocks();

    await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    // Cardinality first: a loop over zero calls satisfies the assertion below
    // without evaluating anything, which is a pass this test must not be able
    // to produce.  One readiness poll plus one extraction.
    expect(evaluateMock.mock.calls).toHaveLength(2);
    for (const [script] of evaluateMock.mock.calls) {
      expect(script).not.toContain("document.body");
    }
  });
});
