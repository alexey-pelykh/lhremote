// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
  gaussianBetween: vi.fn().mockReturnValue(800),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
  maybeBreak: vi.fn().mockResolvedValue(undefined),
  simulateReadingTime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./wait-for-logged-in-state.js", () => ({
  gateOnLoggedInState: vi.fn().mockResolvedValue(undefined),
  waitForLoggedInState: vi.fn().mockResolvedValue(undefined),
  LoggedInStateTimeoutError: class extends Error {},
}));

import { gateOnLoggedInState } from "./wait-for-logged-in-state.js";

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { searchPosts, waitForSearchResults } from "./search-posts.js";
import type { RawDomPost } from "./get-feed.js";
import {
  adaptersFor,
  buildReadinessPredicateSource,
  formatVariantProbes,
} from "../linkedin/dom-variant.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
  ExtractionFailedError,
  ExtractionTimeoutError,
} from "../services/errors.js";

const CDP_PORT = 9222;

/**
 * Markers that tell the three generated scripts apart in the evaluate mock.
 *
 * Keyed on source the generators actually emit, and checked in an order that
 * cannot alias: the extraction script and the readiness predicate BOTH carry
 * the control-menu selector (it is the readiness anchor, and the card filter
 * the extraction requires), so a mock keyed on that string would answer
 * `true` to a scrape and quietly grade nothing at all.
 */
const EXTRACTION_MARKER = "postCardCount";
const READINESS_MARKER = "selection.adapter.ready";
const DETECTION_MARKER = "probes[a.variant]";

/** One successful scrape, as the generated extraction script reports it. */
interface SearchScrape {
  variant: string;
  postCardCount: number;
  posts: RawDomPost[];
}

/**
 * A scrape whose cardinal agrees with its posts — the ordinary case.  Tests
 * that are about the corroborator override `postCardCount` explicitly.
 */
function scrape(
  posts: RawDomPost[],
  overrides: Partial<SearchScrape> = {},
): SearchScrape {
  return {
    variant: "sdui",
    postCardCount: posts.length,
    posts,
    ...overrides,
  };
}

/** A client that answers `evaluate` and nothing else. */
function fakeClient(
  evaluate: (script: string) => Promise<unknown>,
): CDPClient {
  return { evaluate } as unknown as CDPClient;
}

/**
 * Build a minimal raw DOM post object for test assertions.
 */
function rawPost(overrides: Partial<RawDomPost> = {}): RawDomPost {
  return {
    url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    authorName: null,
    authorHeadline: null,
    authorProfileUrl: null,
    text: null,
    mediaType: null,
    reactionCount: 0,
    commentCount: 0,
    shareCount: 0,
    timestamp: null,
    ...overrides,
  };
}

/**
 * Create a script-aware evaluate mock that handles the searchPosts call
 * sequence:
 * 1. waitForSearchResults → the generated readiness predicate, answered true
 * 2. SCRAPE_SEARCH_RESULTS_SCRIPT → one scrape record (may repeat on scroll)
 */
function createEvaluateMock(
  result: SearchScrape | { ambiguousVariants: string[] } | null,
) {
  return vi.fn().mockImplementation((script: string) => {
    const s = String(script);
    if (s.includes(EXTRACTION_MARKER)) return Promise.resolve(result);
    if (s.includes(READINESS_MARKER)) return Promise.resolve(true);
    return Promise.resolve(null);
  });
}

function setupMocks(
  scraped: SearchScrape | { ambiguousVariants: string[] } | null = scrape([]),
) {
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
  const navigate = vi.fn().mockResolvedValue({ frameId: "F1" });
  const send = vi.fn().mockResolvedValue(undefined);
  const evaluate = createEvaluateMock(scraped);

  vi.mocked(CDPClient).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      navigate,
      evaluate,
      send,
    } as unknown as CDPClient;
  });

  return { navigate, disconnect, evaluate, send };
}

describe("searchPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses posts from DOM-scraped data", async () => {
    setupMocks(scrape([
      rawPost({
        url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        authorName: "Alice Smith",
        authorHeadline: "Engineer at Acme",
        authorProfileUrl: "https://www.linkedin.com/in/alice",
        text: "Hello #linkedin #tech world!",
        mediaType: "image",
        reactionCount: 42,
        commentCount: 7,
        shareCount: 3,
        timestamp: "2h",
      }),
    ]));

    const result = await searchPosts({ query: "linkedin", cdpPort: CDP_PORT });
    expect(vi.mocked(gateOnLoggedInState)).toHaveBeenCalled();

    expect(result.query).toBe("linkedin");
    expect(result.posts).toHaveLength(1);
    const [post] = result.posts;
    expect(post?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:123/");
    expect(post?.authorName).toBe("Alice Smith");
    expect(post?.authorHeadline).toBe("Engineer at Acme");
    expect(post?.authorProfileUrl).toBe("https://www.linkedin.com/in/alice");
    expect(post?.text).toBe("Hello #linkedin #tech world!");
    expect(post?.mediaType).toBe("image");
    expect(post?.reactionCount).toBe(42);
    expect(post?.commentCount).toBe(7);
    expect(post?.shareCount).toBe(3);
    expect(post?.hashtags).toEqual(["linkedin", "tech"]);
  });

  it("returns posts with pre-populated URLs", async () => {
    setupMocks(scrape([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ]));

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:1/");
    expect(result.posts[1]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:2/");
  });

  it("navigates to the search results page with query", async () => {
    const { navigate } = setupMocks(scrape([]));

    await searchPosts({ query: "AI agents", cdpPort: CDP_PORT });

    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/search/results/content/"),
    );
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("keywords=AI+agents"),
    );
  });

  it("throws on empty query", async () => {
    await expect(
      searchPosts({ query: "   ", cdpPort: CDP_PORT }),
    ).rejects.toThrow("Search query must not be empty");
  });

  it("limits results to count parameter", async () => {
    setupMocks(scrape([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
    ]));

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 2 });

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:1/");
    expect(result.posts[1]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:2/");
  });

  it("returns nextCursor when more posts are available", async () => {
    setupMocks(scrape([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
    ]));

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 2 });

    expect(result.nextCursor).toBe(2);
  });

  it("returns null nextCursor when all posts are returned", async () => {
    setupMocks(scrape([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ]));

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 10 });

    expect(result.nextCursor).toBeNull();
  });

  it("supports cursor-based pagination", async () => {
    setupMocks(scrape([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:4/" }),
    ]));

    const result = await searchPosts({
      query: "test",
      cdpPort: CDP_PORT,
      count: 2,
      cursor: 2,
    });

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:3/");
    expect(result.posts[1]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:activity:4/");
  });

  it("returns empty posts when cursor is at the end", async () => {
    setupMocks(scrape([
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ]));

    const result = await searchPosts({
      query: "test",
      cdpPort: CDP_PORT,
      cursor: 2,
    });

    expect(result.posts).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("handles empty search results", async () => {
    // A search that genuinely found nothing: the adapter read the page and
    // the page rendered no post-shaped cards, so the cardinal corroborates
    // the empty scrape and the operation returns normally.
    setupMocks(scrape([]));

    const result = await searchPosts({ query: "nonexistent", cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("scrolls to load more posts when count exceeds initial scrape", async () => {
    const { evaluate, send } = setupMocks(scrape([]));

    const firstScrape = [
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
    ];
    const secondScrape = [
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:3/" }),
    ];

    let scrapeIdx = 0;

    evaluate.mockReset();
    evaluate.mockImplementation((script: string) => {
      const s = String(script);
      if (s.includes(EXTRACTION_MARKER)) {
        const posts = [firstScrape, secondScrape][scrapeIdx] ?? secondScrape;
        scrapeIdx++;
        return Promise.resolve(scrape(posts));
      }
      if (s.includes(READINESS_MARKER)) return Promise.resolve(true);
      return Promise.resolve(null);
    });

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 3 });

    expect(result.posts).toHaveLength(3);
    const scrollCalls = send.mock.calls.filter(
      (args) => args[0] === "Input.dispatchMouseEvent",
    );
    expect(scrollCalls).toHaveLength(1);
  });

  it("stops scrolling when no new posts appear", async () => {
    const { evaluate, send } = setupMocks(scrape([]));

    const fixedPosts = [
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
      rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
    ];

    evaluate.mockReset();
    evaluate.mockImplementation((script: string) => {
      const s = String(script);
      if (s.includes(EXTRACTION_MARKER)) return Promise.resolve(scrape(fixedPosts));
      if (s.includes(READINESS_MARKER)) return Promise.resolve(true);
      return Promise.resolve(null);
    });

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT, count: 10 });

    expect(result.posts).toHaveLength(2);
    const scrollCalls = send.mock.calls.filter(
      (args) => args[0] === "Input.dispatchMouseEvent",
    );
    expect(scrollCalls).toHaveLength(1);
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(searchPosts({ query: "test", cdpPort: CDP_PORT })).rejects.toThrow(
      "No LinkedIn page found in LinkedHelper",
    );
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      searchPosts({ query: "test", cdpPort: CDP_PORT, cdpHost: "192.168.1.1" }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("disconnects CDP client after operation", async () => {
    const { disconnect } = setupMocks(scrape([rawPost()]));

    await searchPosts({ query: "test", cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
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
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate: vi.fn().mockRejectedValue(new Error("nav error")),
        evaluate: vi.fn(),
        send: vi.fn(),
      } as unknown as CDPClient;
    });

    await expect(searchPosts({ query: "test", cdpPort: CDP_PORT })).rejects.toThrow(
      "nav error",
    );
    expect(disconnect).toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Variant tolerance and the empty-vs-error contract (#841)
// ───────────────────────────────────────────────────────────────────────────

describe("searchPosts variant binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gates on the predicate generated from the search-results registry", () => {
    // The binding itself, asserted against the production generator rather
    // than against a string this test wrote.  The predicate it replaced asked
    // only whether some `div[role="listitem"]` held a control menu — true on
    // both dialects, so it could not gate a variant-specific extraction.
    const predicate = buildReadinessPredicateSource(
      adaptersFor("search-results"),
    );
    const seen: string[] = [];
    const client = fakeClient((script) => {
      seen.push(script);
      return Promise.resolve(true);
    });

    return waitForSearchResults(client).then(() => {
      expect(seen).toContain(predicate);
    });
  });

  it("returns as soon as the selected adapter's own anchor appears", async () => {
    // Zero-match must NOT raise inside the loop: an unhydrated page also
    // matches zero adapters, so failing fast would fire on every slow load.
    let polls = 0;
    const client = fakeClient((script) => {
      if (String(script).includes(READINESS_MARKER)) {
        polls += 1;
        return Promise.resolve(polls >= 3);
      }
      return Promise.resolve(null);
    });

    await expect(waitForSearchResults(client, 15_000)).resolves.toBeUndefined();
    expect(polls).toBe(3);
  });

  it("classifies a page no adapter claims as unsupported, at the deadline", async () => {
    const client = fakeClient((script) => {
      const s = String(script);
      if (s.includes(READINESS_MARKER)) return Promise.resolve(false);
      if (s.includes(DETECTION_MARKER)) {
        return Promise.resolve({ matched: [], probes: { sdui: 0, legacy: 0 } });
      }
      return Promise.resolve(null);
    });

    const rejection = waitForSearchResults(client, 1);
    await expect(rejection).rejects.toBeInstanceOf(DOMVariantUnsupportedError);
    await expect(rejection).rejects.toThrow(
      "No DOM adapter matched the search-results page",
    );
  });

  it("names both readings of a zero match rather than asserting a markup change", async () => {
    // The class is right and stays: the two states are indistinguishable from
    // the DOM with what is measured today, and returning `posts: []` would
    // hand a caller an empty result it cannot tell apart from a dialect flip.
    // What must not happen is the DIAGNOSIS asserting a cause it only guessed.
    // On post detail "no adapter matched" really does mean LinkedIn moved — a
    // post page always has a post.  Here it does not: a search that matched
    // nothing renders no result cards, so no `detect` anchor can match either,
    // and an operator would be sent to write an adapter for a working page.
    const client = fakeClient((script) => {
      const s = String(script);
      if (s.includes(READINESS_MARKER)) return Promise.resolve(false);
      if (s.includes(DETECTION_MARKER)) {
        return Promise.resolve({ matched: [], probes: { sdui: 0, legacy: 0 } });
      }
      return Promise.resolve(null);
    });

    const error = await waitForSearchResults(client, 1).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DOMVariantUnsupportedError);
    const cause = (error as DOMVariantUnsupportedError).cause;
    expect(cause).toBeInstanceOf(Error);
    const diagnosis = (cause as Error).message;

    // What was OBSERVED, per registered adapter — the diagnosis for the flip.
    expect(diagnosis).toContain("sdui: 0, legacy: 0");
    expect(diagnosis).toContain("No registered adapter's detect anchor matched");
    // BOTH readings of that observation, neither presented as settled.
    expect(diagnosis).toContain("changed its markup");
    expect(diagnosis).toContain("legitimately matched nothing");
  });

  it("classifies a page two adapters claim as ambiguous, at the deadline", async () => {
    const client = fakeClient((script) => {
      const s = String(script);
      if (s.includes(READINESS_MARKER)) return Promise.resolve(false);
      if (s.includes(DETECTION_MARKER)) {
        return Promise.resolve({
          matched: ["sdui", "legacy"],
          probes: { sdui: 6, legacy: 6 },
        });
      }
      return Promise.resolve(null);
    });

    const rejection = waitForSearchResults(client, 1);
    await expect(rejection).rejects.toBeInstanceOf(DOMVariantAmbiguousError);
    await expect(rejection).rejects.toThrow("sdui, legacy");
  });

  it("attaches the detect probe counts as the ambiguous error's cause", async () => {
    // The zero-match branch above already pins its own cause; this is the
    // other `{ cause: … }` site on this gate, and deleting either one alone
    // has to be caught — which one test spanning both branches could not do.
    //
    // Unlike the zero-match cause this one carries no prose — but NOT because
    // the observation has a single reading.  It has two: the page really is
    // hybrid, or a `detect` anchor is over-broad and claimed a sibling's
    // dialect.  ADR-008 § Decision 1 requires `detect` to be exclusive for
    // exactly that reason, and its § Amendments record a reactions-modal case
    // where the collision is inferred rather than measured.  What is true is
    // that both readings take the SAME repair, and the error's own message
    // already carries it: tighten the detect anchors.  So there is nothing
    // for prose to disambiguate here, and the probe counts are the whole
    // diagnosis — which is a claim about the repair, not about the page.
    //
    // The WHOLE message is pinned rather than a substring of it, because what
    // a cause may hold is a privacy boundary: `errorMessage` renders it with
    // no gate in front of it, and `error-message.ts` keeps page content in the
    // `LHREMOTE_CAPTURE_DIAGNOSTICS`-gated bundle instead — noting that this
    // is "a property of the producers, not something checked here".  This is a
    // producer.  A `toContain` would accept a message that appended a scrape.
    //
    // The probe half is derived THROUGH `formatVariantProbes` rather than
    // written as a look-alike literal, so a change to that rendering cannot
    // strand a stale expectation here; the formatter itself is separately
    // pinned against literals in `dom-variant.test.ts`.  The two counts differ
    // on purpose — a symmetric expectation would also be satisfied by a cause
    // built from some other symmetric detection.
    const detection = {
      matched: ["sdui", "legacy"],
      probes: { sdui: 3, legacy: 7 },
    };
    const client = fakeClient((script) => {
      const s = String(script);
      if (s.includes(READINESS_MARKER)) return Promise.resolve(false);
      if (s.includes(DETECTION_MARKER)) return Promise.resolve(detection);
      return Promise.resolve(null);
    });

    const error = await waitForSearchResults(client, 1).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DOMVariantAmbiguousError);
    const cause = (error as DOMVariantAmbiguousError).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe(
      `detect probes — ${formatVariantProbes(detection)}`,
    );
  });

  it("reports a plain timeout when exactly one adapter matched", async () => {
    // The dialect is known and it simply never finished rendering.  Blaming
    // LinkedIn for a markup change here would send the operator to write an
    // adapter that already exists.
    const client = fakeClient((script) => {
      const s = String(script);
      if (s.includes(READINESS_MARKER)) return Promise.resolve(false);
      if (s.includes(DETECTION_MARKER)) {
        return Promise.resolve({
          matched: ["legacy"],
          probes: { sdui: 0, legacy: 6 },
        });
      }
      return Promise.resolve(null);
    });

    const rejection = waitForSearchResults(client, 1);
    await expect(rejection).rejects.toBeInstanceOf(ExtractionTimeoutError);
    await expect(rejection).rejects.toThrow(
      "readiness anchor of the selected search-results adapter",
    );
  });

  it("falls back to the plain timeout when the classification probe is unusable", async () => {
    // A malformed probe result says the instrument did not run usefully — it
    // is NOT the claim "no adapter matched".
    const client = fakeClient((script) => {
      const s = String(script);
      if (s.includes(READINESS_MARKER)) return Promise.resolve(false);
      return Promise.resolve(undefined);
    });

    await expect(waitForSearchResults(client, 1)).rejects.toBeInstanceOf(
      ExtractionTimeoutError,
    );
  });

  it("extracts under the SDUI dialect", async () => {
    setupMocks(
      scrape(
        [
          rawPost({
            url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
            authorName: "Alice Smith",
            text: "Hello #sdui world!",
          }),
        ],
        { variant: "sdui" },
      ),
    );

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.authorName).toBe("Alice Smith");
  });

  it("extracts under the legacy dialect", async () => {
    // Acceptance criterion 1's other half.  Nothing in the operation branches
    // on the variant — the same call path carries a legacy scrape through.
    setupMocks(
      scrape(
        [
          rawPost({
            url: "https://www.linkedin.com/feed/update/urn:li:activity:9/",
            authorName: "Bob Jones",
            text: "A legacy-rendered post body.",
          }),
        ],
        { variant: "legacy" },
      ),
    );

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.authorName).toBe("Bob Jones");
  });

  it("raises when the page rendered post cards but the scrape found none", async () => {
    // Corroborated-empty.  This is the live shape of the defect: under legacy
    // markup every SDUI selector matches zero, so every card is skipped and
    // an empty list comes back with a success.  The cardinal was counted on
    // the same cards, so the disagreement is a self-contradiction.
    setupMocks(scrape([], { variant: "legacy", postCardCount: 6 }));

    const rejection = searchPosts({ query: "test", cdpPort: CDP_PORT });
    await expect(rejection).rejects.toBeInstanceOf(ExtractionFailedError);
    // The message must name the variant and the field: an agent consuming the
    // MCP tool is the least able party to diagnose this.
    await expect(rejection).rejects.toThrow('adapter "legacy" matched');
    await expect(rejection).rejects.toThrow('field "posts"');
    await expect(rejection).rejects.toThrow("postCardCount=6");
  });

  it("does not raise when a genuinely empty result set is corroborated", async () => {
    // The other direction, and it is not optional: implementing only the
    // raise rebuilds always-throw-on-empty, which is what this contract
    // exists to forbid.
    setupMocks(scrape([], { variant: "sdui", postCardCount: 0 }));

    const result = await searchPosts({ query: "test", cdpPort: CDP_PORT });

    expect(result.posts).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("does not raise when a cursor past the end empties the window", async () => {
    // Corroboration runs on the RAW scrape, before the cursor window is
    // sliced.  A `start` offset past the end of a successful scrape yields no
    // rows legitimately — that is a fact about the caller's request, not an
    // observation about the page.
    setupMocks(
      scrape([
        rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/" }),
        rawPost({ url: "https://www.linkedin.com/feed/update/urn:li:activity:2/" }),
      ]),
    );

    const result = await searchPosts({
      query: "test",
      cdpPort: CDP_PORT,
      cursor: 5,
    });

    expect(result.posts).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("raises unsupported when no adapter claims the page at extraction time", async () => {
    // The readiness gate went green and the page then turned out unreadable —
    // or the claiming adapter enumerated no cards.  Either way nothing read
    // the page, and there is no `<main>` left to pretend otherwise with.
    setupMocks(null);

    const error = await searchPosts({ query: "test", cdpPort: CDP_PORT }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DOMVariantUnsupportedError);
    // And it does NOT carry the gate's two-readings qualifier, deliberately.
    // Readiness already went green, so exactly one adapter matched a card on
    // this page moments ago — a search that found nothing could never have got
    // here, and repeating "the search may have matched nothing" would offer an
    // excuse the state rules out.
    const diagnosis = String(
      ((error as DOMVariantUnsupportedError).cause as Error | undefined)
        ?.message ?? "",
    );
    expect(diagnosis).not.toContain("legitimately matched nothing");
  });

  it("raises ambiguous rather than picking when two adapters claim the page", async () => {
    setupMocks({ ambiguousVariants: ["sdui", "legacy"] });

    const rejection = searchPosts({ query: "test", cdpPort: CDP_PORT });
    await expect(rejection).rejects.toBeInstanceOf(DOMVariantAmbiguousError);
    await expect(rejection).rejects.toThrow("sdui, legacy");
  });
});
