// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// Diagnostic capture on `getPost`'s EXTRACTION-failure path (#835).
//
// Kept out of `get-post.test.ts` deliberately: that file carries the #827
// extraction-contract oracle, which is executor-uneditable by construction.
// These cases grade a different thing — not *whether* a contradicted scrape
// raises (the oracle owns that) but whether a diagnostic bundle is written on
// the way out — so they belong in their own file, following the
// `{module}-{concern}.test.ts` precedent already set by
// `get-feed-author-anchor.test.ts`.
//
// Why the behaviour needs pinning at all: the readiness gate's capture is
// bound to a deadline, and this failure never reaches one.  The gate goes
// green in milliseconds, an adapter matches, the post body extracts fine, and
// only then does `commentCount: 41` come back next to `comments: []`.  Until
// #835 that left ADR-007's "inspect these artifacts before changing
// post-detail selectors" undischargeable for exactly the defect class it
// exists to serve.

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

vi.mock("./get-feed.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  parseTimestamp: vi.fn(() => null),
}));

// The capture writes real files.  Mock the fs surface so the assertions can
// read what would have landed on disk without touching it — mirrors the
// mock already used by `wait-for-post-load.test.ts`.
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}TESTABCDEF`),
  writeFile: vi.fn().mockResolvedValue(undefined),
  lstat: vi.fn().mockResolvedValue({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    mode: 0o700,
  }),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

import { writeFile } from "node:fs/promises";

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionFailedError,
} from "../services/errors.js";

// Dynamic import after the mocks are registered, matching the convention the
// sibling capture suites document: relying on vi.mock hoisting to cover a
// module that reaches `node:fs/promises` at load time is brittle under ESM
// transforms (`wait-for-post-load.test.ts` header).
const { getPost } = await import("./get-post.js");

describe("getPost extraction-failure diagnostics (#835)", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  // A post claiming five comments.  Paired with an empty scrape below, this
  // is the self-contradiction that raises — pinned locally rather than
  // inherited so a later default change cannot quietly remove the premise.
  const CONTRADICTED_POST_DETAIL = {
    variant: "sdui",
    authorName: "John Doe",
    authorHeadline: "Software Engineer",
    authorProfileUrl: "https://www.linkedin.com/in/johndoe",
    text: "Hello world!",
    reactionCount: 42,
    commentCount: 5,
    shareCount: 3,
    timestamp: "2024-11-15T10:00:00.000Z",
  };

  const DETECTION = { matched: ["sdui"], probes: { sdui: 1, legacy: 0 } };

  const CAPTURE_PROBE = {
    href: POST_URL,
    title: "Post | LinkedIn",
    hasMain: true,
    hasMainFeed: true,
    mainFeedListItemCount: 1,
    mainFeedListItemsWithMenuButton: 1,
    mainFeedListItemsViableForPostScrape: 1,
    hasAuthorLink: true,
    hasAuthorLinkInMain: true,
    hasLtrSpans: true,
    hasArticles: true,
    hasReactLikeButton: false,
    hasCommentOnButton: false,
    hasTopLevelEditor: false,
    hasReactionsMenu: true,
    // Since #853 the registry's own anchors reach the bundle here, under each
    // dialect's name, in place of the `hasPostDetailContainer` boolean this
    // fixture used to carry.  Kept in sync because a mock naming a field the
    // probe no longer returns lies about the shape without ever failing.
    variantAnchors: {
      sdui: { ready: 1, scopes: {}, counts: {} },
      legacy: { ready: 0, scopes: {}, counts: {} },
    },
    // Non-zero: the comment layer IS rendered, which together with a
    // matching adapter is what says "the comment-field selectors went stale"
    // rather than "the page never rendered comments".
    commentElementCount: 41,
    bodyTextSnippet: "Hello world!\n",
  };

  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  /**
   * Drive `getPost` to the contradicted-scrape failure.
   *
   * The evaluate sequence walks the real call order: readiness poll, post
   * detail, comment count for the load-more loop, one load-more probe that
   * declines, the empty comment scrape that contradicts `commentCount: 5`,
   * then — only on the failure path — the variant-detection probe and the
   * capture's own DOM probe.
   *
   * @param detection - What the variant-detection probe resolves to, or an
   *   `Error` to reject with (a probe that throws is non-evidence, not a
   *   verdict).
   */
  function setupContradictedScrape(detection: unknown = DETECTION) {
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

    const evaluateMock = vi.fn();
    evaluateMock.mockResolvedValueOnce(true); // readiness
    evaluateMock.mockResolvedValueOnce(CONTRADICTED_POST_DETAIL);
    evaluateMock.mockResolvedValueOnce(0); // loaded-comment count
    evaluateMock.mockResolvedValueOnce(false); // no "load more" to click
    evaluateMock.mockResolvedValueOnce([]); // the empty scrape
    if (detection instanceof Error) {
      evaluateMock.mockRejectedValueOnce(detection);
    } else {
      evaluateMock.mockResolvedValueOnce(detection);
    }
    evaluateMock.mockResolvedValueOnce(CAPTURE_PROBE);

    const disconnect = vi.fn();
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });

    return { evaluateMock, disconnect };
  }

  /** The JSON bundle the capture would have written, parsed. */
  function writtenBundle(): Record<string, unknown> {
    const jsonCall = vi
      .mocked(writeFile)
      .mock.calls.find((call) => String(call[0]).endsWith(".json"));
    expect(jsonCall).toBeDefined();
    return JSON.parse(String(jsonCall?.[1])) as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) {
      delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    } else {
      process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = originalEnv;
    }
  });

  it("writes a diagnostic bundle when the comment scrape contradicts itself", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupContradictedScrape();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // The propagated error must still be the extraction contract's, not one
    // manufactured by the capture machinery — a bare `.toThrow()` would pass
    // either way.
    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(ExtractionFailedError);

    const paths = vi.mocked(writeFile).mock.calls.map((call) => String(call[0]));
    expect(paths.some((path) => path.endsWith(".json"))).toBe(true);
    // Named for the failure that actually happened.  A bundle stamped
    // `wait-for-post-load` here would send the next reader hunting a slow
    // page that was never slow — the readiness gate went green.
    expect(
      paths.every((path) =>
        path.includes("post-detail-extraction-failure-"),
      ),
    ).toBe(true);
    expect(paths.some((path) => path.includes("wait-for-post-load-"))).toBe(
      false,
    );
    warnSpy.mockRestore();
  });

  it("records the per-adapter detection probes in the bundle", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupContradictedScrape();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    // The whole point of #835: a non-zero probe says our adapter DID claim
    // the page, so the diagnosis is "a field's selectors went stale", not
    // "LinkedIn served a dialect we don't know".  Nothing else in the bundle
    // can make that distinction — every other probe is a fixed selector.
    expect(writtenBundle()).toMatchObject({
      trigger: "extraction-failure",
      variantDetection: { matched: ["sdui"], probes: { sdui: 1, legacy: 0 } },
      // The layer the error itself names ("repair the selectors for
      // `comments`").  Every other probe answers a readiness question.
      commentElementCount: 41,
    });
    warnSpy.mockRestore();
  });

  it("records a null detection when the probe yields no usable reading", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupContradictedScrape(new Error("evaluate failed"));
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    // `null`, not an all-zero probe map: a broken instrument says nothing
    // about the page, and an all-zero map would read as the positive claim
    // "no adapter matched" — the exact misdiagnosis this records against.
    expect(writtenBundle().variantDetection).toBeNull();
    warnSpy.mockRestore();
  });

  it("reports the real artifact path on the warn line", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupContradictedScrape();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    // The per-invocation mkdtemp directory is the ONLY place these artifacts
    // live, so a warn line that does not carry the actual path leaves the
    // operator unable to find them at all.
    const writtenJsonPath = String(
      vi
        .mocked(writeFile)
        .mock.calls.find((call) => String(call[0]).endsWith(".json"))?.[0] ??
        "",
    );
    expect(writtenJsonPath).not.toBe("");
    expect(message).toContain(writtenJsonPath.replace(/\.json$/, ""));
    expect(message).toContain("extraction-failure diagnostics");
    warnSpy.mockRestore();
  });

  it("is default-off: writes nothing when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    setupContradictedScrape();

    // Still raises — the extraction contract (#827/#834) is independent of
    // whether diagnostics are being collected.
    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    // The bundle contains page content, i.e. personal data.  CLI and MCP
    // callers must never write it silently.
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("does not probe or capture when the scrape is not contradicted", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    // Cardinal agrees with the empty list: a legitimately comment-less post.
    // Guards against the capture degenerating into fire-on-every-empty, which
    // would spray personal data into tmp on the happy path.
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
    const evaluateMock = vi.fn();
    evaluateMock.mockResolvedValueOnce(true);
    evaluateMock.mockResolvedValueOnce({
      ...CONTRADICTED_POST_DETAIL,
      commentCount: 0,
    });
    evaluateMock.mockResolvedValueOnce(0);
    evaluateMock.mockResolvedValueOnce(false);
    evaluateMock.mockResolvedValueOnce([]);
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.comments).toEqual([]);
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
    // Five evaluates and no more: the detection probe and the capture probe
    // are on the failure path only, so the happy path pays nothing for them.
    expect(evaluateMock).toHaveBeenCalledTimes(5);
  });

  it("keeps propagating the caller's error when the capture itself fails", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupContradictedScrape();
    const { writeFile: wf } = await import("node:fs/promises");
    vi.mocked(wf).mockRejectedValueOnce(new Error("disk full"));

    // A capture-side failure must never replace the diagnosis it was written
    // to explain.
    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(ExtractionFailedError);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // The scrape's OWN variant failures.  Issue #835 names all three error
  // classes, and these two are the same deadline-free shape: `waitForPostLoad`
  // returned green, and only then did the extraction find no adapter — or
  // two.  Before #835 they raised with no artifact at all.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Drive `getPost` to a post-detail scrape that fails variant selection.
   *
   * @param scrapeResult - What `SCRAPE_POST_DETAIL_SCRIPT` resolves to:
   *   `null` for "no adapter claimed the page", or an `ambiguousVariants`
   *   record for "two or more did".
   */
  function setupVariantFailure(scrapeResult: unknown) {
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
    const evaluateMock = vi.fn();
    evaluateMock.mockResolvedValueOnce(true); // readiness
    evaluateMock.mockResolvedValueOnce(scrapeResult);
    evaluateMock.mockResolvedValueOnce(DETECTION);
    evaluateMock.mockResolvedValueOnce(CAPTURE_PROBE);
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });
    return { evaluateMock };
  }

  it("captures when no adapter claims the page, and still raises unsupported", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupVariantFailure(null);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    expect(writtenBundle()).toMatchObject({ trigger: "extraction-failure" });
    warnSpy.mockRestore();
  });

  it("captures when two adapters claim the page, and still raises ambiguous", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupVariantFailure({ ambiguousVariants: ["sdui", "legacy"] });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantAmbiguousError);

    expect(writtenBundle()).toMatchObject({ trigger: "extraction-failure" });
    warnSpy.mockRestore();
  });

  it("does not probe for detection when diagnostics are off", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    const { evaluateMock } = setupVariantFailure(null);

    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(DOMVariantUnsupportedError);

    // Two evaluates and no more: readiness, then the scrape.  The detect
    // probe's only consumer is the bundle, so a default-off CLI or MCP run
    // must not spend a round-trip in the page producing it for nobody — and
    // the capture's own gate fires too late to prevent that, since the probe
    // would already have been evaluated as its argument.
    expect(evaluateMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});
