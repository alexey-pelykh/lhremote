// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import type { PostEngager } from "../types/post-analytics.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import {
  diagnosticCaptureEnabled,
  probeVariantDetection,
  waitForPostLoad,
} from "../cdp/wait-for-post-load.js";
import {
  captureReactionsModalFailure,
  waitForReactionsModal,
} from "../cdp/wait-for-reactions-modal.js";
import {
  assertCardinalCorroboration,
  contradictsEmptyExtraction,
} from "../linkedin/corroboration.js";
import {
  adaptersFor,
  buildReactionsModalExtractionSource,
  buildReactionsModalScrollSource,
  buildReactionsModalTotalSource,
  buildReactionsTriggerSource,
  variantNamesFor,
} from "../linkedin/dom-variant.js";
import {
  DOMVariantAmbiguousError,
  DOMVariantUnsupportedError,
} from "../services/errors.js";
import type { ConnectionOptions } from "./types.js";
import { extractPostUrn, resolvePostDetailUrl } from "./get-post-stats.js";
import { gaussianDelay, gaussianBetween, maybeHesitate, maybeBreak, simulateReadingTime } from "../utils/delay.js";
import { humanizedScrollTo, humanizedClick } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { navigateAwayIf } from "./navigate-away.js";

/**
 * Input for the get-post-engagers operation.
 */
export interface GetPostEngagersInput extends ConnectionOptions {
  /** LinkedIn post URL or raw URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrl: string;
  /** Number of engagers to return per page (default: 20). */
  readonly count?: number | undefined;
  /** Offset for pagination (default: 0). */
  readonly start?: number | undefined;
  /** Optional humanized mouse for natural cursor movement and scrolling. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

/**
 * Output from the get-post-engagers operation.
 */
export interface GetPostEngagersOutput {
  /** Resolved post URN. */
  readonly postUrn: string;
  /** List of people who engaged with the post. */
  readonly engagers: PostEngager[];
  /** Pagination metadata. */
  readonly paging: {
    readonly start: number;
    readonly count: number;
    readonly total: number;
  };
}

// ---------------------------------------------------------------------------
// Raw shapes returned by the in-page scripts
// ---------------------------------------------------------------------------

interface RawEngager {
  firstName: string;
  lastName: string;
  publicId: string | null;
  headline: string | null;
  engagementType: string;
}

/**
 * Two or more adapters claimed the page.
 *
 * Returned by the trigger script and by the engager scrape alike, because
 * both select an adapter and a hybrid page is a refusal at either point.
 */
interface AmbiguousVariants {
  ambiguousVariants: string[];
}

function isAmbiguous(value: unknown): value is AmbiguousVariants {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as AmbiguousVariants).ambiguousVariants)
  );
}

// ---------------------------------------------------------------------------
// In-page DOM scraping scripts
// ---------------------------------------------------------------------------

/** The page kind this operation reads; picks the adapter list it binds to. */
const REACTIONS_MODAL_SURFACE = "reactions-modal" as const;

/**
 * The variant named in an `ExtractionFailedError` when the detect probe on the
 * failure path yielded no single claimant.
 *
 * A placeholder, and deliberately one that reads as such: a value an operator
 * cannot act on has to admit it rather than name a dialect nobody observed.
 *
 * **What the operator actually sees, quoted rather than paraphrased**, because
 * the two halves pull in different directions:
 *
 * > Extraction failed on the reactions-modal page: adapter "unknown" matched,
 * > but field "engagers" came back empty while totalReactions=2 contradicts
 * > it. Adapter "unknown" is partially stale — repair the selectors for
 * > "engagers".
 *
 * The second sentence is the actionable one and is why the placeholder has to
 * read as a placeholder.  The FIRST sentence asserts a match that, on this
 * path, by construction did not happen — the probe resolved no single
 * claimant, so nothing matched.  The message is shared with `get-post` and
 * `search-posts`, where the variant is always a real dialect and the assertion
 * is true, so it is stated here rather than reworded there; an operator who
 * reads "adapter \"unknown\" matched" should read it as *the corroborator
 * fired and the dialect could not be named*, not go looking for an adapter by
 * that name.
 *
 * **Two readings reach it, and only one is a broken instrument.**  The probe
 * itself failing or returning an ambiguous result is — nothing was read.  But
 * a probe that ran fine and reported ZERO matches also leaves the placeholder
 * in place, and that is a reading OF the page: LinkedIn is serving a dialect
 * no adapter claims.  The repair differs (fix the probe vs. register an
 * adapter), and the bundle tells them apart: `variantDetection.probes` reads
 * `sdui: 0, legacy: 0` for the second and is absent or malformed for the
 * first.
 *
 * Spelled `"unknown"` deliberately, the same token `get-post` and
 * `search-posts` write into this field.  `variant` is a readable property MCP
 * consumers surface, so a second spelling for one meaning would cost every log
 * filter a second token.  The real distinction between the three — this one is
 * REACHABLE, the other two are type-checker seeds on paths that always resolve
 * a dialect — is a property of the code, not of the value, and an operator
 * reading the field cannot decode it either way; it is recorded here instead.
 */
const UNKNOWN_VARIANT = "unknown";

/**
 * How many times an empty-but-contradicted scrape is re-read before the
 * cardinal tier is allowed to raise.
 *
 * Bounded rather than a deadline: the modal is already open and its container
 * already rendered, so this is a settle, not a wait for a page.  Two attempts
 * at roughly a second apart is the same cadence the collect loop already
 * pauses at between scrolls; more would delay a genuine stale-selector
 * diagnosis, and fewer would not cross a re-render.
 */
const EMPTY_SCRAPE_SETTLE_ATTEMPTS = 2;

/**
 * JavaScript source evaluated inside the LinkedIn post detail page to find the
 * control that opens the reactions modal and mark it for the subsequent
 * humanized scroll + click.
 *
 * Generated from the surface's adapter registry, so the dialect is detected on
 * the page being read rather than assumed.  The finder it replaces scanned
 * `button, [role="button"], span, a` document-wide for an element whose TEXT
 * read `"<N> reactions"`; under the legacy markup LinkedIn is serving that
 * matched nothing — legacy renders the count as a bare `"2"` and puts the
 * words only on the control's `aria-label` — so the modal was never opened and
 * the operation reported `engagers: []` on a post that has two (#823).
 */
const FIND_REACTIONS_TRIGGER_SCRIPT = buildReactionsTriggerSource(
  adaptersFor(REACTIONS_MODAL_SURFACE),
);

/** Selector for the marked reactions element. */
const REACTIONS_SELECTOR = "[data-lhremote-reactions]";

/**
 * JavaScript source that extracts engager rows from the reactions modal.
 *
 * Returns an array (empty included), `null` when no adapter resolved the
 * modal, or the ambiguity report.  The `null` IS this surface's container
 * tier — see {@link buildReactionsModalExtractionSource}.
 */
const SCRAPE_ENGAGERS_SCRIPT = buildReactionsModalExtractionSource(
  adaptersFor(REACTIONS_MODAL_SURFACE),
);

/**
 * JavaScript source that reads the reaction total — the cardinal that
 * corroborates an empty engager list.  Prefers the count stamped on the
 * trigger before the click; falls back to the modal's own text.
 */
const GET_MODAL_TOTAL_SCRIPT = buildReactionsModalTotalSource(
  adaptersFor(REACTIONS_MODAL_SURFACE),
);

/**
 * Build a scroll-modal script with a randomised scroll distance.
 *
 * The distance varies between 350–650 px to avoid the detection signal of a
 * perfectly uniform modal scroll cadence.
 */
function createScrollModalScript(distance: number): string {
  return buildReactionsModalScrollSource(
    adaptersFor(REACTIONS_MODAL_SURFACE),
    distance,
  );
}

/**
 * Write an extraction-failure diagnostic bundle for the reactions modal the
 * client is sitting on, then return so the caller can raise.
 *
 * Sibling of `get-post`'s `capturePostDetailExtractionFailure`, and gated the
 * same way: the detect probe is a diagnostic-only read whose sole consumer is
 * the bundle, so a default-off CLI or MCP run must not spend a
 * `Runtime.evaluate` in the page for nobody — and the capture's own gate fires
 * too late to prevent that, because the probe would already have been
 * evaluated as its argument.
 *
 * The cardinal-contradiction site does NOT go through here, and the difference
 * is deliberate: there the probe also names the adapter in the error, so it
 * runs whether or not capture is on.
 *
 * Never throws: `probeVariantDetection` degrades to `null` and
 * `captureReactionsModalFailure` swallows its own failures, so the caller's
 * error always propagates unchanged.
 */
async function captureEngagerExtractionFailure(
  client: CDPClient,
): Promise<void> {
  if (!diagnosticCaptureEnabled()) return;
  const detection = await probeVariantDetection(
    client,
    adaptersFor(REACTIONS_MODAL_SURFACE),
  );
  await captureReactionsModalFailure(client, {
    trigger: "extraction-failure",
    detection,
  });
}

// ---------------------------------------------------------------------------
// Main operation
// ---------------------------------------------------------------------------

/**
 * Retrieve the list of people who engaged with a LinkedIn post.
 *
 * Connects to the LinkedIn webview in LinkedHelper, navigates to the
 * post detail page, opens the reactions modal via UI interaction, and
 * extracts engager data from the rendered DOM.
 *
 * @param input - Post URL or URN, pagination parameters, and CDP connection options.
 * @returns List of engagers with pagination metadata.
 */
export async function getPostEngagers(
  input: GetPostEngagersInput,
): Promise<GetPostEngagersOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const count = input.count ?? 20;
  const start = input.start ?? 0;

  const postDetailUrl = resolvePostDetailUrl(input.postUrl);

  // Try to extract URN for the output postUrn field
  let postUrn: string;
  try {
    postUrn = extractPostUrn(input.postUrl);
  } catch {
    postUrn = input.postUrl;
  }

  // Enforce loopback guard
  if (!allowRemote && cdpHost !== "127.0.0.1" && cdpHost !== "localhost") {
    throw new Error(
      `Non-loopback CDP host "${cdpHost}" requires --allow-remote. ` +
        "This is a security measure to prevent remote code execution.",
    );
  }

  const targets = await discoverTargets(cdpPort, cdpHost);
  const linkedInTarget = targets.find(
    (t) => t.type === "page" && t.url?.includes("linkedin.com"),
  );

  if (!linkedInTarget) {
    throw new Error(
      "No LinkedIn page found in LinkedHelper. " +
        "Ensure LinkedHelper is running with an active LinkedIn session.",
    );
  }

  const client = new CDPClient(cdpPort, { host: cdpHost, allowRemote });
  await client.connect(linkedInTarget.id);

  try {
    // Navigate away if already on the post detail page to force a fresh load
    await navigateAwayIf(client, "/feed/update/");

    // Navigate to the post detail page
    await client.navigate(postDetailUrl);

    // Wait for the post content to render
    await waitForPostLoad(client);

    const mouse = input.mouse ?? null;

    // Find the control that opens the reactions modal and mark it.
    const found = await client.evaluate<boolean | AmbiguousVariants>(
      FIND_REACTIONS_TRIGGER_SCRIPT,
    );
    if (isAmbiguous(found)) {
      // A transitional or hybrid page.  Refuse rather than pick: the two
      // dialects put the trigger in different places, so clicking one dialect's
      // affordance on a page that is also speaking the other opens a modal
      // nothing downstream is bound to read.
      throw new DOMVariantAmbiguousError(
        REACTIONS_MODAL_SURFACE,
        found.ambiguousVariants,
      );
    }
    if (!found) {
      // No adapter claimed the page, or the claiming dialect renders no
      // reactions affordance.  This branch RETURNS rather than raising, and
      // that is the one place this surface departs from post detail and search
      // results, where a zero-detect page is `DOMVariantUnsupportedError`.
      //
      // Those surfaces can raise because their page always has the thing they
      // are looking for: a post-detail page always has a post. A post-detail
      // page does NOT always have reactions, so a missing trigger has a third
      // reading here that is both common and benign — nobody reacted — and
      // raising would throw on ordinary posts.
      //
      // The premise underneath that is REASONED, not measured, and it is worth
      // naming: a zero-reaction post is believed to render no
      // `[data-reaction-details]` trigger at all, which would make an absent
      // trigger a clean genuinely-zero discriminator.  The 2026-09-02 spike
      // measured a post WITH reactions; the zero case was not observed.  Its
      // falsifier is a live probe of a zero-reaction post's DOM: if such a post
      // renders a trigger reading "0 reactions", this branch is unreachable on
      // it and the modal opens on an empty list instead — which the container
      // tier below then handles correctly anyway.
      //
      // This is also the disposition of the test held at
      // `get-post-engagers.test.ts:199` pending spike #830 ("returns empty
      // engagers when no reactions button found"). The spike decided CONFIRM,
      // not invert: that test is a third control alongside the two in the
      // oracle block, and it stays green unchanged.
      return {
        postUrn,
        engagers: [],
        paging: { start, count: 0, total: 0 },
      };
    }

    // Humanized scroll to the reactions element and click it
    await maybeHesitate(); // Probabilistic pause before interaction
    await humanizedScrollTo(client, REACTIONS_SELECTOR, mouse);
    await humanizedClick(client, REACTIONS_SELECTOR, mouse);

    // Wait for the reactions modal to load
    await waitForReactionsModal(client);

    // Extract total from modal header
    const total = await client.evaluate<number>(GET_MODAL_TOTAL_SCRIPT);

    /**
     * This surface's container-tier refusal, as the error it warrants, with
     * the diagnostic capture already written.
     *
     * Shared by the two in-page reads that can report the modal became
     * unreadable — the engager scrape below and the pagination scroll further
     * down — because they report the SAME two conditions, and a second copy of
     * the classification is how one contract becomes two that drift.  The
     * scroll held exactly that contrary reading until #840 round 3: it
     * collapsed both conditions into the `false` the collect loop takes as
     * *reached the bottom*, so a modal that re-rendered into an unresolvable
     * state mid-collection returned the rows scraped before the re-render with
     * no error at all, while the very next scrape would have raised.
     *
     * RETURNS the error rather than throwing it, so each call site keeps its
     * own `throw`: the capture is awaited, and an awaited never-returning call
     * is not something the type checker narrows control flow on.
     *
     * @param refusal - The ambiguity record when two or more adapters claimed
     *   the page, or `null` when none did or the claiming one resolved no
     *   modal root.
     */
    const unreadableModalError = async (
      refusal: AmbiguousVariants | null,
    ): Promise<Error> => {
      // Both are deadline-free failures on a modal whose readiness gate went
      // green milliseconds ago, so the capture has to fire here rather than
      // at a timeout that will never come.
      await captureEngagerExtractionFailure(client);
      if (refusal) {
        return new DOMVariantAmbiguousError(
          REACTIONS_MODAL_SURFACE,
          refusal.ambiguousVariants,
        );
      }
      return new DOMVariantUnsupportedError(
        REACTIONS_MODAL_SURFACE,
        variantNamesFor(REACTIONS_MODAL_SURFACE).map(String),
      );
    };

    /**
     * One engager scrape, with this surface's CONTAINER tier applied.
     *
     * Enforced structurally and upstream of any per-field check — ADR-008
     * § Decision 4, mirrored from post detail.  `null` means no adapter claimed
     * the modal or the claiming one resolved no root: nothing read the region,
     * and there is no `document` left to pretend otherwise with.  An EMPTY
     * ARRAY means the opposite — the container resolved and held no rows — and
     * is returned for the cardinal tier to judge.  The code this replaces
     * wrote `scraped ?? []`, which coalesced exactly those two into one value.
     *
     * A function rather than inline code because the settle-and-retry below
     * re-reads the modal and must apply the identical tier: a re-read that
     * came back `null` while the first did not is the container going away
     * mid-collection, which is still "the region was not read".
     */
    const scrapeEngagers = async (): Promise<RawEngager[]> => {
      const scraped = await client.evaluate<
        RawEngager[] | AmbiguousVariants | null
      >(SCRAPE_ENGAGERS_SCRIPT);

      if (!scraped || isAmbiguous(scraped)) {
        throw await unreadableModalError(isAmbiguous(scraped) ? scraped : null);
      }
      return scraped;
    };

    // Scroll and collect engagers until we have enough or can't load more
    const targetCount = start + count;
    let allEngagers: RawEngager[] = [];
    const maxScrollAttempts = 20;

    let previousEngagerCount = 0;
    // The settle budget is GLOBAL to the whole collect, not per scroll
    // iteration: the counter is hoisted out of the loop the re-reads happen
    // in, so a modal that keeps coming back empty cannot spend
    // `EMPTY_SCRAPE_SETTLE_ATTEMPTS` again on every scroll.
    let settleAttempts = 0;
    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      allEngagers = await scrapeEngagers();

      // Settle-and-retry, INSIDE the collect loop and immediately after the
      // scrape, so a successful re-read falls through to the `>= targetCount`
      // check and the scroll path below rather than out of the collection
      // entirely.
      //
      // Readiness on this surface stops at the CONTAINER tier — the modal's
      // own tab strip — which is what makes a genuinely-zero modal legal
      // instead of a timeout.  The price is that readiness now goes green
      // while the reactor payload may still be arriving, and the collect loop
      // cannot wait it out on its own: a modal with zero rows has no
      // scrollable region, so the scroll source declines on the first attempt
      // and the loop breaks after ONE scrape.  A modal mid-hydration would
      // therefore reach the raise below and report `ExtractionFailedError`
      // against a diagnostic bundle showing a perfectly healthy open modal,
      // naming a selector repair that is not needed — and the
      // partial-hydration variant is worse because it is silent.
      //
      // The post-detail adapters answer the same hazard the other way, by
      // gating readiness on a STRICTER-than-container anchor ("a container can
      // be present in a skeleton state before the post body hydrates").  This
      // surface cannot: a stricter anchor is exactly the row-tier predicate
      // #840 removed.  So the wait moves here instead, where it costs nothing
      // on a page that read cleanly.
      //
      // Its PLACEMENT is load-bearing and was got wrong once.  Sitting after
      // the collect loop, a successful re-read never returned to it, so
      // pagination was skipped entirely: a 50-reaction post whose modal
      // hydrates slowly returned however many rows happened to be in the DOM
      // on the re-read, with `paging.total: 50`, no scrolling attempted and no
      // error — the cardinal check passes the moment `extractedCount > 0`, so
      // the under-collection was silent and looked like a successful call.
      //
      // Gated on `contradictsEmptyExtraction`, which is false the moment a
      // single row was scraped, so a HEALTHY run — and a legitimately empty
      // one, whose cardinal is 0 — spends no additional `client.evaluate` at
      // all, on this or any later iteration.  That is load-bearing: the
      // success-path evaluate sequence is pinned by the uneditable oracle.
      // Sharing the predicate with the assertion below is also what keeps this
      // one contract rather than a third copy of the rule.
      //
      // WHAT THIS SETTLE DOES NOT CLOSE, stated here because the block above
      // reads as though it closed the whole class.  It closes the case where
      // the first scrape is EMPTY and a re-read supplies the rows.  It does
      // NOT close the case where the first scrape is merely SHORT — 3 of 50
      // rows caught mid-hydration.  `contradictsEmptyExtraction` short-
      // circuits on ANY non-zero extraction, and that one predicate gates both
      // this settle and the cardinal raise below, so a short read spends no
      // re-read here and cannot be contradicted there.  Three rows do not
      // overflow their container either, so the scroll declines, the loop
      // breaks, and the call returns 3 engagers with `paging.total: 50` and no
      // error.
      //
      // That is not an oversight of this fix; it is the contract this surface
      // implements.  Empty-vs-error, not complete-vs-error: a partial read
      // against a larger cardinal is REQUIRED to return normally, and the
      // uneditable oracle specifies it — `get-post-engagers.test.ts`, "stops
      // scrolling when modal is at bottom", asserts one engager against
      // `totalReactions: 5`.  Both candidate repairs (widening the gate to
      // `extractedCount < cardinal`, or re-reading once after a declined
      // scroll) turn that test red.  Recorded rather than closed, with its
      // falsifier, in ADR-008 § Residuals.
      while (
        settleAttempts < EMPTY_SCRAPE_SETTLE_ATTEMPTS &&
        contradictsEmptyExtraction({
          cardinal: total,
          extractedCount: allEngagers.length,
        })
      ) {
        settleAttempts++;
        await gaussianDelay(1_000, 100, 800, 1_200);
        allEngagers = await scrapeEngagers();
      }

      if (allEngagers.length >= targetCount) break;

      if (scroll < maxScrollAttempts) {
        const modalDistance = Math.round(gaussianBetween(500, 75, 350, 650));
        const scrolled = await client.evaluate<
          boolean | AmbiguousVariants | null
        >(createScrollModalScript(modalDistance));

        // The CONTAINER tier, applied to the scroll exactly as
        // `scrapeEngagers` applies it to the read.  A modal that can no longer
        // be resolved has not reported a scroll position at all, so treating
        // its refusal as *reached the bottom* is a failure to read the region
        // reported as an observation about it (#840).
        //
        // The discrimination is STRICT — `null`, and the ambiguity shape —
        // because those are the only two refusals the source emits.  Every
        // other falsy reading keeps the meaning it has always had, and `false`
        // in particular must still break: it is the ordinary bottom, and a
        // loop that raised on it would fail every post whose reactors fit one
        // screen.
        if (scrolled === null || isAmbiguous(scrolled)) {
          throw await unreadableModalError(
            isAmbiguous(scrolled) ? scrolled : null,
          );
        }
        if (!scrolled) break;
        await gaussianDelay(1_000, 100, 800, 1_200);

        // Reading simulation: pause proportional to newly visible engager entries.
        // Estimate ~80 chars per engager (name + headline).
        const newEngagers = allEngagers.length - previousEngagerCount;
        if (newEngagers > 0) {
          await simulateReadingTime(newEngagers * 80);
        }
        previousEngagerCount = allEngagers.length;

        await maybeBreak();
      }
    }

    // Corroborate the scrape before trusting an empty one.  `total` was read
    // from the very modal this scrape ran against, so the modal reporting N
    // reactions while the list yields none is a self-contradiction within one
    // observation (#834).
    //
    // Deliberately BEFORE the modal is dismissed below, and that ordering is
    // load-bearing rather than cosmetic (#835): the diagnostic capture on the
    // failure path probes modal-scoped selectors (`dialogCount`,
    // `resolvedModalAncestorTag`, the reactions-tab ancestor walk) and takes a
    // screenshot.  Run after the Escape dispatch, it would record
    // `dialogCount: 0` on a page whose modal we had just closed ourselves —
    // which is the fingerprint of a DIFFERENT, already-known regression
    // (#773, modal never opened), for a failure whose actual cause is the row
    // scrape inside a modal that opened fine.  `total` and `allEngagers` are
    // both settled by this point, so nothing else moves by checking here.
    //
    // Deliberately measured on the whole scrape, not on the pagination window
    // below: a `start` past the end of a successful scrape legitimately yields
    // no rows, and that is a caller's offset, not a failed extraction.
    //
    // No skip-analogue guard is needed here, unlike get-post: the scrape runs
    // whatever `count` is, so an empty result is always an observation.
    //
    // The dialect is resolved HERE rather than carried out of the scrape, and
    // the reason is the shape of what the scrape returns: an array of rows,
    // with nowhere to put a variant that would not also change what an empty
    // result looks like.  Resolving it costs one `Runtime.evaluate`, so it is
    // spent only where its answer is about to be printed — inside the branch
    // the corroborator is about to raise from.  A healthy run, and a
    // legitimately empty one, pay nothing.  Sharing
    // `contradictsEmptyExtraction` with the assertion below is what keeps that
    // an optimisation rather than a second copy of the contract (#840).
    let variant = UNKNOWN_VARIANT;
    if (
      contradictsEmptyExtraction({
        cardinal: total,
        extractedCount: allEngagers.length,
      })
    ) {
      // Not gated on LHREMOTE_CAPTURE_DIAGNOSTICS, unlike the container-tier
      // capture above: this reading also names the adapter an operator has to
      // repair, and that has to reach a default-off CLI or MCP run too.
      const detection = await probeVariantDetection(
        client,
        adaptersFor(REACTIONS_MODAL_SURFACE),
      );
      if (detection && detection.matched.length === 1) {
        variant = detection.matched[0] ?? UNKNOWN_VARIANT;
      }
      // Capture on the way out (#835) — the same widening applied to
      // `get-post`'s comment scrape, for the same reason: this failure never
      // reaches a deadline.  `waitForReactionsModal` already returned green
      // (the modal opened and rendered its container), so a timeout-gated
      // capture cannot see the contradiction that follows it.
      //
      // Self-gated on LHREMOTE_CAPTURE_DIAGNOSTICS and swallows its own
      // errors, so the raise below is unaffected either way.
      await captureReactionsModalFailure(client, {
        trigger: "extraction-failure",
        detection,
      });
    }

    assertCardinalCorroboration({
      surface: REACTIONS_MODAL_SURFACE,
      variant,
      field: "engagers",
      cardinalName: "totalReactions",
      cardinal: total,
      extractedCount: allEngagers.length,
    });

    // Close the modal.  Only reached on the success path now — a raise above
    // leaves it open, which costs nothing (the `finally` disconnects) and
    // keeps the captured screenshot showing the modal that failed.
    await client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
    });

    // Apply pagination window
    const sliced = allEngagers.slice(start, start + count);
    const engagers: PostEngager[] = sliced.map((e) => ({
      firstName: e.firstName,
      lastName: e.lastName,
      publicId: e.publicId,
      headline: e.headline,
      engagementType: e.engagementType,
    }));

    await gaussianDelay(800, 300, 300, 1_800); // Post-action dwell
    return {
      postUrn,
      engagers,
      paging: {
        start,
        count: engagers.length,
        total: total || allEngagers.length,
      },
    };
  } finally {
    client.disconnect();
  }
}
