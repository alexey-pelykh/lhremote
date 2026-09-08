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

vi.mock("./get-feed.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  parseTimestamp: vi.fn((raw: string | null) => {
    if (!raw) return null;
    const asDate = Date.parse(raw);
    if (!isNaN(asDate)) return asDate;
    return null;
  }),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import {
  DOMVariantUnsupportedError,
  ExtractionFailedError,
} from "../services/errors.js";
import { getPost } from "./get-post.js";

describe("getPost", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  const DEFAULT_POST_DETAIL = {
    authorName: "John Doe",
    authorHeadline: "Software Engineer",
    authorProfileUrl: "https://www.linkedin.com/in/johndoe",
    text: "Hello world! This is a long post text.",
    reactionCount: 42,
    commentCount: 5,
    shareCount: 3,
    timestamp: "2024-11-15T10:00:00.000Z",
    // A post with fifty engagement events renders the row it counts them in,
    // so `true` is the realistic reading for this record — and it is inert
    // for every case built on it, because the container tier only speaks when
    // all three counters are zero (#951).  Stated rather than left absent so
    // the default says what it means instead of passing on `undefined` being
    // falsy.
    countsRootNarrowed: true,
  };

  const DEFAULT_COMMENTS = [
    {
      commentUrn: "urn:li:comment:(activity:1234567890,111111111)",
      authorName: "Alice Smith",
      authorHeadline: "Product Manager",
      authorPublicId: "alices",
      text: "Great post!",
      createdAt: "2024-11-15T11:00:00.000Z",
      reactionCount: 2,
    },
  ];

  function setupMocks(opts?: {
    postDetail?: unknown;
    comments?: unknown;
    readySequence?: boolean[];
    articleCount?: number;
    loadMoreClicked?: boolean[];
  }) {
    const {
      postDetail = DEFAULT_POST_DETAIL,
      comments = DEFAULT_COMMENTS,
      readySequence = [true],
      articleCount = 1,
      loadMoreClicked = [false],
    } = opts ?? {};

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
    // 2. post detail (object)
    // 3. article count for load-more loop (number)
    // 4. load more click result (boolean) — repeats until false
    // 5. final comments scrape (array)
    const evaluateMock = vi.fn();
    for (const ready of readySequence) {
      evaluateMock.mockResolvedValueOnce(ready);
    }
    evaluateMock.mockResolvedValueOnce(postDetail);
    evaluateMock.mockResolvedValueOnce(articleCount);
    for (const clicked of loadMoreClicked) {
      evaluateMock.mockResolvedValueOnce(clicked);
      if (clicked) {
        // After a successful click, the loop checks article count again
        evaluateMock.mockResolvedValueOnce(articleCount);
      }
    }
    evaluateMock.mockResolvedValueOnce(comments);

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

  /**
   * The ambient `LHREMOTE_CAPTURE_DIAGNOSTICS`, read before any test in this
   * file has had a chance to mutate it.
   *
   * Under the attached root config that snapshot is always the pinned-off
   * value: since #925 `vitest.config.ts` wires `setupFiles: [vitest.setup.ts]`
   * and the setup file deletes the variable at its own module scope, before
   * this module is evaluated.  This guard is therefore live only when that
   * config detaches — a package-level `vite.config.*` / `vitest.config.*`
   * would stop it resolving for this package alone — which is the case it is
   * now kept for.
   */
  const originalCaptureEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  beforeEach(() => {
    vi.clearAllMocks();
    // Several cases below reach a diagnostic capture, and this file mocks no
    // filesystem.  `get-post.ts` calls `capturePostDetailExtractionFailure`
    // at exactly two sites: every `setupMocks({ postDetail: null })` case
    // lands on the first, and the ORACLE block's cardinal-contradiction cases
    // on the second.  Both are named rather than cited by line, because a
    // line number in a comment about ANOTHER file decays with nothing to
    // catch it, and this repo already carries one that has.
    //
    // That capture self-gates on `diagnosticCaptureEnabled()`, which reads
    // `process.env` per call rather than at module load — so under an ambient
    // `LHREMOTE_CAPTURE_DIAGNOSTICS=1`, a plausible export while debugging
    // diagnostics, a Tier-1 unit run would `mkdtemp` and write real bundles
    // into `os.tmpdir()`, contradicting CLAUDE.md section Testing's "Tier 1 —
    // Unit ... Dependency: None".  Pinning the gate off here makes every
    // environment agree with CI, which never sets the variable.  The capture
    // path itself is graded in `get-post-extraction-diagnostics.test.ts`,
    // which does mock the filesystem.
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Hand the shell back exactly the value it had, including "unset".
    if (originalCaptureEnv === undefined) {
      delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    } else {
      process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = originalCaptureEnv;
    }
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      getPost({ postUrl: POST_URL, cdpPort: CDP_PORT, cdpHost: "192.168.1.1" }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(getPost({ postUrl: POST_URL, cdpPort: CDP_PORT })).rejects.toThrow(
      "No LinkedIn page found in LinkedHelper",
    );
  });

  it("navigates to post detail URL and extracts post data from DOM", async () => {
    const { navigate } = setupMocks();

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/",
    );

    expect(result.post.postUrn).toBe("urn:li:activity:1234567890");
    expect(result.post.authorName).toBe("John Doe");
    expect(result.post.authorHeadline).toBe("Software Engineer");
    expect(result.post.authorPublicId).toBe("johndoe");
    expect(result.post.text).toBe("Hello world! This is a long post text.");
    expect(result.post.reactionCount).toBe(42);
    expect(result.post.commentCount).toBe(5);
    expect(result.post.shareCount).toBe(3);
  });

  it("extracts comments from DOM", async () => {
    setupMocks();

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      commentUrn: "urn:li:comment:(activity:1234567890,111111111)",
      authorName: "Alice Smith",
      authorHeadline: "Product Manager",
      authorPublicId: "alices",
      text: "Great post!",
      reactionCount: 2,
    });
  });

  it("returns paging metadata from visible comments", async () => {
    setupMocks({
      comments: [
        { commentUrn: null, authorName: "A", text: "c1", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { commentUrn: null, authorName: "B", text: "c2", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
      ],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.commentsPaging).toEqual({
      start: 0,
      count: 2,
      total: 2,
    });
  });

  it("throws a typed DOMVariantUnsupportedError when extraction yields nothing", async () => {
    setupMocks({ postDetail: null });

    // Both assertions grade ONE invocation: `getPost` is called once and the
    // settled rejection is asserted against twice. Re-invoking would re-run
    // the mocked call, so any side effect it accrues would differ between the
    // class check and the message check.
    const rejection = getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    await expect(rejection).rejects.toThrow(DOMVariantUnsupportedError);
    await expect(rejection).rejects.toThrow(
      /No DOM adapter matched the post-detail page/,
    );
  });

  it("handles missing optional fields in post detail", async () => {
    setupMocks({
      postDetail: {
        authorName: null,
        authorHeadline: null,
        authorProfileUrl: null,
        text: null,
        reactionCount: 0,
        commentCount: 0,
        shareCount: 0,
        timestamp: null,
        // The counts row did not resolve, which is what makes an all-zero
        // record legal rather than a contradicted read (#951).  Pinned
        // explicitly: with the field absent this case would still pass, on
        // `undefined` being falsy rather than on the state it means to
        // describe.
        countsRootNarrowed: false,
      },
      comments: [],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.post.postUrn).toBe("urn:li:activity:1234567890");
    expect(result.post.authorName).toBe("");
    expect(result.post.authorHeadline).toBeNull();
    expect(result.post.authorPublicId).toBeNull();
    expect(result.post.text).toBe("");
    expect(result.post.publishedAt).toBeNull();
    expect(result.post.reactionCount).toBe(0);
    expect(result.post.commentCount).toBe(0);
    expect(result.post.shareCount).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ORACLE — extraction contract (#827). Pre-authored; executor-uneditable.
  //
  // Encodes the empty-vs-error contract this migration must satisfy. Authored
  // BEFORE the implementation, deliberately, because an executor that writes
  // both the fix and the assertions grading it has no independent gate.
  //
  // The implementing items (#831, #832, #834) MUST NOT edit these beyond one
  // documented transition:  it.fails(...)  ->  it(...)
  //
  // `it.fails` passes while its body fails. Every `it.fails` body here fails
  // today, since the contract is not implemented yet — so CI is green and this
  // oracle can land first. The moment an implementation makes one pass,
  // `it.fails` turns RED, forcing the implementer to acknowledge the behaviour
  // flip in a one-token diff instead of silently absorbing it.
  //
  // The plain `it(...)` cases in this block are CONTROLS and are green today.
  // They must STAY green: they are what stops the fix degenerating into
  // always-throw-on-empty.
  //
  // These inversions REPLACE the previous tests that asserted the opposite for
  // the same fixtures. The suite must encode ONE contract, not two.
  //
  // Assertions are on OBSERVABLE BEHAVIOUR — does it throw? — never on error
  // class names, so #832 stays free to name its classes without rewriting the
  // oracle that grades it.
  // ───────────────────────────────────────────────────────────────────────────
  describe("ORACLE: corroborated emptiness (#827)", () => {
    // Cardinal corroborator: a count in the SAME response contradicts the empty
    // field. commentCount 5 with zero comments is self-contradictory — the
    // extraction failed, it did not observe an empty comment section.
    it(
      "throws when comments are empty but commentCount contradicts it",
      async () => {
        // The contradicting cardinal is pinned HERE, not inherited from
        // DEFAULT_POST_DETAIL. If the default were later changed to 0 this
        // would become a LEGAL empty, the body would still fail, `it.fails`
        // would still pass — and the oracle would silently stop testing the
        // contract it claims to test.
        setupMocks({
          postDetail: { ...DEFAULT_POST_DETAIL, commentCount: 5 },
          comments: [],
        });

        await expect(
          getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
        ).rejects.toThrow();
      },
    );

    it(
      "throws when comments evaluate to null but commentCount contradicts it",
      async () => {
        // Contradicting cardinal pinned locally — see the note above.
        setupMocks({
          postDetail: { ...DEFAULT_POST_DETAIL, commentCount: 5 },
          comments: null,
        });

        await expect(
          getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
        ).rejects.toThrow();
      },
    );

    // GUARD on the oracle's own premise — deliberately a plain `it`, OUTSIDE
    // every `it.fails`. A guard placed INSIDE an `it.fails` body is worthless:
    // that block passes whenever its body fails for ANY reason, so a failing
    // guard is indistinguishable from the intended failure.
    //
    // The inversions above depend on setupMocks honouring an explicit
    // commentCount override. If that ever stops working, they would set up a
    // fixture with no contradiction, still fail, and still pass under
    // `it.fails` — silently testing nothing. This test goes RED instead.
    it("guard: setupMocks honours an explicit commentCount override", async () => {
      setupMocks({
        postDetail: { ...DEFAULT_POST_DETAIL, commentCount: 7 },
      });

      const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

      expect(result.post.commentCount).toBe(7);
    });

    // CONTROL — MUST STAY GREEN. Without this, the fix degenerates into
    // always-throw-on-empty and breaks every post that legitimately has no
    // comments. A zero cardinal corroborates the empty list: this is legal.
    it("does NOT throw when comments are empty and commentCount agrees", async () => {
      setupMocks({
        postDetail: { ...DEFAULT_POST_DETAIL, commentCount: 0 },
        comments: [],
      });

      const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

      expect(result.comments).toEqual([]);
      expect(result.post.commentCount).toBe(0);
    });

    // CONTROL — MUST STAY GREEN. Container corroborator: the region's anchor
    // matched, so absent text is a legal image-only / link-only post, not a
    // stale selector. Empty text must normalise to "" and must not throw.
    it('does NOT throw when text is absent but the container matched, and yields ""', async () => {
      setupMocks({
        postDetail: { ...DEFAULT_POST_DETAIL, text: null, commentCount: 0 },
        comments: [],
      });

      const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

      expect(result.post.text).toBe("");
    });

    // Container corroborator, negative case: the container itself did not
    // match, so there is no same-observation evidence that the page is empty.
    // Already true on main; pinned here so a later refactor cannot silently
    // downgrade it to a success.
    it("throws when the post-detail container did not match at all", async () => {
      setupMocks({ postDetail: null });

      await expect(
        getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
      ).rejects.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CONTAINER tier — engagement-counts corroboration (#951).
  //
  // Outside the #827 oracle deliberately.  That block is executor-uneditable
  // and grades the CARDINAL tier: an empty comment list against a count the
  // page rendered.  These grade the tier underneath it — whether that count
  // was read at all — on a record shape none of the oracle's cases construct.
  //
  // The defect: `getPost` publishes the same three counters `getPostStats`
  // does, off the same record, and feeds `commentCount` to the cardinal check
  // as the corroborator.  A counts row that resolved and read nothing does not
  // merely return a wrong count — it returns a corroborator that agrees with
  // an empty comment list, so the operation reported a legal empty for a post
  // whose count it could not read.
  describe("counts-row corroboration (#951)", () => {
    /** Every counter zero — the reading the two branches below disagree about. */
    const ZERO_COUNTERS = {
      ...DEFAULT_POST_DETAIL,
      reactionCount: 0,
      commentCount: 0,
      shareCount: 0,
      // Named rather than left to the `|| "unknown"` fallback: `legacy` is
      // the only dialect that can reach this tier at all, because `sdui`
      // declares `counts: []` and so never narrows its counts root (#950).
      // A record built here without a variant would exercise a shape no live
      // page produces.
      variant: "legacy",
    };

    it("throws when the counts row resolved and every counter read zero", async () => {
      setupMocks({
        postDetail: { ...ZERO_COUNTERS, countsRootNarrowed: true },
        comments: [],
      });

      // One invocation, asserted against three times: re-invoking would re-run
      // the mocked sequence, and the queued values are consumed.
      const rejection = getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

      await expect(rejection).rejects.toThrow(ExtractionFailedError);
      // The diagnosis must name the ROW, because that is where the repair is.
      // Reported against `comments` instead, it would send the next reader to
      // selectors that are working fine.
      await expect(rejection).rejects.toThrow(/field "engagementCounts"/);
      await expect(rejection).rejects.toThrow(/countsRoot=rendered/);
    });

    it("does NOT throw when the counts row did not resolve and every counter is zero", async () => {
      setupMocks({
        postDetail: { ...ZERO_COUNTERS, countsRootNarrowed: false },
        comments: [],
      });

      // The ordinary shape of a post with no engagement, and the case that
      // keeps this check off every one of them.  Without it the tier would be
      // a blanket "empty means broken" rather than corroboration.
      const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

      expect(result.post.commentCount).toBe(0);
      expect(result.post.reactionCount).toBe(0);
      expect(result.comments).toEqual([]);
    });

    it("does NOT throw when the counts row resolved and one counter is non-zero", async () => {
      setupMocks({
        postDetail: {
          ...ZERO_COUNTERS,
          reactionCount: 7,
          countsRootNarrowed: true,
        },
        comments: [],
      });

      // The corroborator is ROW-level, not per-counter: a post carrying
      // reactions and no comments is the ordinary shape of most posts, and a
      // per-counter raise would fire on all of them.
      const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

      expect(result.post.reactionCount).toBe(7);
      expect(result.post.commentCount).toBe(0);
      expect(result.comments).toEqual([]);
    });

    it("does NOT throw when the counts row resolved and only reposts are non-zero", async () => {
      setupMocks({
        postDetail: {
          ...ZERO_COUNTERS,
          shareCount: 7,
          countsRootNarrowed: true,
        },
        comments: [],
      });

      // The sum's second term.  Sibling to the case above, and both exist
      // because the check reads `reactionCount + commentCount + shareCount`:
      // a mutant dropping any one term survives every case that only ever
      // makes a DIFFERENT term non-zero.  Covered for `getPostStats` by that
      // operation's own `it.each`, over the same shared binding — but the
      // cross-suite dependency is invisible from here, so it is not relied on.
      const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

      expect(result.post.shareCount).toBe(7);
      expect(result.post.reactionCount).toBe(0);
      expect(result.comments).toEqual([]);
    });

    it("does NOT throw when the counts row resolved and only comments are non-zero", async () => {
      setupMocks({
        postDetail: {
          ...ZERO_COUNTERS,
          commentCount: 7,
          countsRootNarrowed: true,
        },
        comments: DEFAULT_COMMENTS,
      });

      // The sum's third term, and the one that cannot be posed against an
      // empty list: `commentCount: 7` beside `comments: []` is precisely what
      // the CARDINAL tier refuses (#834).  Supplying the comments keeps this
      // case about the container tier and nothing else.
      const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

      expect(result.post.commentCount).toBe(7);
      expect(result.post.reactionCount).toBe(0);
      expect(result.comments).toHaveLength(1);
    });

    it("throws even when comment loading was skipped", async () => {
      setupMocks({
        postDetail: { ...ZERO_COUNTERS, countsRootNarrowed: true },
        comments: [],
      });

      // The check is unconditional, unlike the cardinal one it precedes.
      // `commentCount: 0` skips comment LOADING, not counter reading, and the
      // returned `post` carries the same three counters `getPostStats` grades
      // off the identical record — so gating this on the input would leave
      // this call a way to obtain counters that operation would have refused.
      await expect(
        getPost({ postUrl: POST_URL, cdpPort: CDP_PORT, commentCount: 0 }),
      ).rejects.toThrow(ExtractionFailedError);
    });

    it("throws when the counts row resolved and read zero beside a non-empty comment list", async () => {
      setupMocks({
        postDetail: { ...ZERO_COUNTERS, countsRootNarrowed: true },
        comments: DEFAULT_COMMENTS,
      });

      // Pins the OUTCOME of the ADR's row 2 — a resolved-but-zero row refuses
      // whatever the comment list would have held — and not a distinct code
      // path.  The queued `comments` are never consumed: the refusal lands
      // before the comment scrape runs, so this record reaches the tier
      // exactly as the empty-list case above does.  That is itself the point
      // of the ordering.  The cardinal tier could not reach this shape in any
      // arrangement, because it returns early on a non-empty extraction; only
      // the container tier can refuse it, and under this ordering it does so
      // without ever learning whether comments exist.
      await expect(
        getPost({ postUrl: POST_URL, cdpPort: CDP_PORT }),
      ).rejects.toThrow(ExtractionFailedError);
    });

    it("reports the region, not the cardinal, when a record satisfies both tiers", async () => {
      setupMocks({
        postDetail: {
          ...DEFAULT_POST_DETAIL,
          reactionCount: -5,
          commentCount: 5,
          shareCount: 0,
          countsRootNarrowed: true,
        },
        comments: [],
      });

      // This record is NOT reachable from the live parse — the counter
      // patterns capture `\d[\d,]*` and coerce a failed parse to 0, so no
      // page produces a negative — and that is exactly why the case exists.
      // On the real domain the two tiers are disjoint (`commentCount > 0`
      // implies a non-zero sum), so ordering them is unobservable there and
      // the precedence would be untestable.  A negative counter is the only
      // construction that makes both predicates true at once, which is what
      // turns the ordering into something a test can hold.
      //
      // Region first: the cardinal is a number read OUT OF the row, so it is
      // worth consulting only once the row has been vouched for.  Were the
      // order flipped this would report `field "comments"` against
      // `commentCount=5`.
      const rejection = getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

      await expect(rejection).rejects.toThrow(/field "engagementCounts"/);
      await expect(rejection).rejects.toThrow(/countsRoot=rendered/);
    });
  });

  it("waits for post to load with polling", async () => {
    const { evaluateMock } = setupMocks({
      readySequence: [false, false, true],
    });

    await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    // 3 readiness + 1 post detail + 1 article count + 1 load-more (false) + 1 comments = 7
    expect(evaluateMock).toHaveBeenCalledTimes(7);
  });

  it("extracts authorPublicId from profile URL", async () => {
    setupMocks({
      postDetail: {
        ...DEFAULT_POST_DETAIL,
        authorProfileUrl: "https://www.linkedin.com/in/jane-doe-123",
        // Comments are incidental here — this test is about the author URL.
        // The cardinal is pinned to 0 to match the empty list: the default 5
        // would describe a page claiming five comments and rendering none,
        // which is the contradiction the extraction contract now rejects.
        commentCount: 0,
      },
      comments: [],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });
    expect(result.post.authorPublicId).toBe("jane-doe-123");
  });

  it("returns null authorPublicId for company URLs", async () => {
    setupMocks({
      postDetail: {
        ...DEFAULT_POST_DETAIL,
        authorProfileUrl: "https://www.linkedin.com/company/acme-corp",
        // Cardinal pinned to 0 to match the empty list — see the note above.
        commentCount: 0,
      },
      comments: [],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });
    expect(result.post.authorPublicId).toBeNull();
  });

  it("clicks load-more to expand comments", async () => {
    setupMocks({
      articleCount: 2,
      loadMoreClicked: [true, true, false],
      comments: [
        { commentUrn: null, authorName: "A", text: "c1", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { commentUrn: null, authorName: "B", text: "c2", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { commentUrn: null, authorName: "C", text: "c3", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
      ],
    });

    const result = await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(result.comments).toHaveLength(3);
  });

  it("skips comment loading when commentCount is 0", async () => {
    const { evaluateMock } = setupMocks({ comments: [] });

    const result = await getPost({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      commentCount: 0,
    });

    expect(result.comments).toEqual([]);
    // readiness + post detail + comments scrape (no load-more loop)
    // With commentCount=0: 1 ready + 1 post + 1 comments = 3
    expect(evaluateMock).toHaveBeenCalledTimes(3);
  });

  it("limits comments to commentCount", async () => {
    setupMocks({
      comments: [
        { commentUrn: null, authorName: "A", text: "c1", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { commentUrn: null, authorName: "B", text: "c2", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
        { commentUrn: null, authorName: "C", text: "c3", authorPublicId: null, authorHeadline: null, createdAt: null, reactionCount: 0 },
      ],
    });

    const result = await getPost({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      commentCount: 2,
    });

    expect(result.comments).toHaveLength(2);
  });

  it("disconnects CDP client after successful operation", async () => {
    const { disconnect } = setupMocks();

    await getPost({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
    const { disconnect } = setupMocks({ postDetail: null });

    await expect(getPost({ postUrl: POST_URL, cdpPort: CDP_PORT })).rejects.toThrow();

    expect(disconnect).toHaveBeenCalled();
  });
});
