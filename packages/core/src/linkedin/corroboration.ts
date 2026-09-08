// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { ExtractionFailedError } from "../services/errors.js";

/**
 * One empty extraction and the cardinal that corroborates or contradicts it.
 */
export interface CardinalObservation {
  /** The page kind being read (e.g. `post-detail`, `reactions-modal`). */
  readonly surface: string;
  /** Which markup dialect — or which scraper — produced the record. */
  readonly variant: string;
  /** The field that came back empty (e.g. `comments`, `engagers`). */
  readonly field: string;
  /** Name of the count being consulted, as it appears in the diagnosis. */
  readonly cardinalName: string;
  /** The count LinkedIn rendered on the page that was just scraped. */
  readonly cardinal: number;
  /** How many records the extraction actually produced. */
  readonly extractedCount: number;
}

/**
 * Cardinal corroboration — an empty extraction is trustworthy only when a
 * signal from the *same observation* corroborates it.
 *
 * The cardinal is a count LinkedIn rendered on the very page that was just
 * scraped (`commentCount`, `totalReactions`). It settles the one question a
 * bare empty list cannot answer on its own:
 *
 * - cardinal `0` — the page says there is nothing to find and nothing was
 *   found. Legitimately empty; return normally. This is the ordinary case for
 *   a post with no comments and for a post with no reactions, and keeping it
 *   working is why this is a corroboration check rather than a blanket
 *   "empty means broken".
 * - cardinal `> 0` — the page says there are N and the scrape found none. The
 *   two halves of one observation contradict each other, so the record is not
 *   evidence that the page is empty; it is evidence that the field's selectors
 *   no longer match. Raise, rather than return a record no caller can tell
 *   apart from a real empty one.
 *
 * The failure this closes was observed live on 2026-08-31: `commentCount: 41`
 * returned alongside `comments: []`, with an HTTP success (#834).
 *
 * The complementary tier is CONTAINER corroboration — did the region's own
 * anchor match at all? That tier is what keeps an absent post body legal (an
 * image-only or link-only post has no text and a perfectly good container),
 * and on the post-detail surface it is already enforced upstream for the POST
 * container: an adapter that cannot resolve its own scope yields no record at
 * all and raises `DOMVariantUnsupportedError`. It is NOT enforced for every
 * region inside that container, and the engagement-counts row was the one left
 * unenforced — see {@link contradictsEmptyRegion}, which is that tier written
 * out for a region the scope check cannot speak for (#852). The two tiers are
 * deliberately not collapsed into one — a single "empty implies stale" rule
 * false-positives on every image-only and link-only post.
 *
 * Split into a PREDICATE and an assertion because one caller has to know the
 * verdict *before* the raise: `get-post-engagers` resolves which dialect is on
 * the page — a `Runtime.evaluate` it will not spend on a healthy run — only
 * when the answer is about to be named in an error. Re-deriving the rule at
 * that call site would put two copies of one contract in two files, which is
 * the failure this module exists to prevent one level down.
 *
 * @param observation - What was extracted, and the count to consult.
 * @returns Whether the cardinal contradicts an empty extraction.
 */
export function contradictsEmptyExtraction(observation: {
  readonly cardinal: number;
  readonly extractedCount: number;
}): boolean {
  if (observation.extractedCount > 0) return false;

  // Written as `cardinal > 0` — a POSITIVE test for a positive count — rather
  // than as the negation of a `cardinal <= 0` legality test. The distinction
  // is not stylistic, and it is worth stating at the line that carries it
  // because inverting this predicate IS the failure mode.
  //
  // `> 0` is true only for a positive count, so every other value falls to the
  // caller as "no contradiction": zero (the legal empty this whole check
  // exists to preserve), a negative, and `NaN`. The last is the one that
  // discriminates the two spellings. A guard written as `!(cardinal <= 0)`
  // reads as its equivalent and is not: `NaN <= 0` is `false`, so that form
  // returns `true` and reports `commentCount=NaN` — a parsing regression
  // somewhere else surfacing as a stale-selector diagnosis pointing at this
  // field. Both current producers already coerce a failed parse to 0, so this
  // is defence in depth rather than a live path.
  //
  // Where the inversion now happens: `assertCardinalCorroboration` below
  // early-returns on `!contradictsEmptyExtraction(...)`, and
  // `get-post-engagers` reads the same predicate positively to decide whether
  // to spend a dialect probe. One rule, one spelling, three readers.
  return observation.cardinal > 0;
}

/**
 * One finished collection, and the cardinal that corroborates or contradicts
 * its COMPLETENESS.
 *
 * Deliberately a separate shape from {@link CardinalObservation}, which
 * describes a single scrape and carries the terms an
 * {@link ExtractionFailedError} prints.  Nothing here is printed in an error,
 * because nothing here raises.
 */
export interface CollectionObservation {
  /** How many records the collection produced, before any pagination window. */
  readonly extractedCount: number;
  /** How many the caller asked for — `start + count`, not `count` alone. */
  readonly requestedCount: number;
  /** The count LinkedIn rendered on the page that was just scraped. */
  readonly cardinal: number;
}

/**
 * Collection corroboration — the COMPLETE-vs-partial companion to
 * {@link contradictsEmptyExtraction}, and deliberately not an extension of it.
 *
 * The two answer different questions and warrant different outcomes:
 *
 * - {@link contradictsEmptyExtraction} asks *did the scrape read the field at
 *   all?*  A positive cardinal beside zero rows is a broken selector, so it
 *   RAISES — a record no caller can tell apart from a real empty one is worse
 *   than an error.
 * - This asks *did the collector get everything it went for?*  Fewer rows than
 *   the page claims is NOT evidence of a broken selector: the rows that did
 *   arrive parsed fine.  It is evidence the collection stopped early, and the
 *   caller is the party that can decide whether that matters.  So it REPORTS.
 *
 * Merging them — widening the empty predicate to `extractedCount < cardinal` —
 * is the repair this deliberately is not.  It would raise on a page that
 * legitimately renders fewer reactor rows than its own count claims (blocked,
 * deleted or restricted accounts), turning a routine call into a stale-selector
 * diagnosis pointing at selectors that are fine.  The uneditable oracle pins
 * that outcome directly: `get-post-engagers.test.ts`, "stops scrolling when
 * modal is at bottom", requires one engager against `totalReactions: 5` to
 * return normally.
 *
 * **`requestedCount` is what keeps this off the ordinary pagination path**, and
 * it is a count rather than a "did the collector give up" flag on purpose.  A
 * caller that asks for 5 of 227 and gets 5 has a complete answer to the
 * question it asked, and `paging.total` already tells it more exist; firing
 * there would make the signal worth ignoring.  A collector only ends BELOW what
 * it went for when it could not get more — that equivalence is what lets this
 * be checked from the two counts instead of asserted by the caller, and a
 * caller that stops early for some other reason would need to say so rather
 * than reuse this.
 *
 * The measurement that made this real, taken live on 2026-09-03 against a
 * 227-reaction post under the legacy markup: the reactor pane
 * (`.artdeco-modal__content.social-details-reactors-modal__content`) is
 * `clientHeight: 476` with `max-height: none` and rows averaging 84 px, so it
 * takes about six rows to overflow.  Below that the scroll source finds no
 * scrollable region at all, falls back to the modal, and its `scrollTop` write
 * is a no-op — it returns `false`, which the collect loop reads as *reached the
 * bottom*.  A first scrape landing at one to five rows therefore ends the
 * collection outright.  Observed in the same run: readiness went green on a
 * 56 px, zero-row pane, and the rows arrived about a second later (#874).
 *
 * @param observation - What was collected, what was asked for, and the count to
 *   consult.
 * @returns Whether the cardinal contradicts a collection that stopped.
 */
export function contradictsCompleteCollection(
  observation: CollectionObservation,
): boolean {
  if (observation.extractedCount >= observation.requestedCount) return false;

  // `>` against the extracted count, for the same reason the sibling predicate
  // is written `cardinal > 0` rather than `!(cardinal <= 0)`: a strictly
  // positive test lets every unusable cardinal fall through as "no
  // contradiction".  `NaN > 3` is `false`, so a parsing regression upstream
  // reports nothing here instead of manufacturing a shortfall against a count
  // that was never read.  Equality falls through too — a collection that
  // matched the cardinal exactly is complete, however short the caller finds
  // it, and that is the legal "the page claims 5 and rendered 5" case.
  return observation.cardinal > observation.extractedCount;
}

/**
 * Cardinal corroboration as an assertion — {@link contradictsEmptyExtraction}
 * plus the error it warrants.  The rule itself lives on that predicate; this
 * is the only place it becomes a raise.
 *
 * @param observation - What was extracted, and the count to consult.
 * @throws {ExtractionFailedError} When the extraction is empty and the
 *   cardinal contradicts it.
 */
export function assertCardinalCorroboration(
  observation: CardinalObservation,
): void {
  if (!contradictsEmptyExtraction(observation)) return;

  throw new ExtractionFailedError({
    surface: observation.surface,
    variant: observation.variant,
    field: observation.field,
    corroborator: `${observation.cardinalName}=${String(observation.cardinal)}`,
  });
}

/**
 * One empty REGION read, and whether that region's own anchor rendered.
 *
 * Deliberately a separate shape from {@link CardinalObservation}: that one
 * consults a count LinkedIn rendered, this one consults whether the element
 * the read was rooted in was there at all.  It carries the same four terms an
 * {@link ExtractionFailedError} prints, because unlike
 * {@link CollectionObservation} it does raise.
 */
export interface RegionObservation {
  /** The page kind being read (e.g. `post-detail`). */
  readonly surface: string;
  /** Which markup dialect — or which scraper — produced the record. */
  readonly variant: string;
  /** The field that came back empty (e.g. `engagementCounts`). */
  readonly field: string;
  /** Name of the region being consulted, as it appears in the diagnosis. */
  readonly regionName: string;
  /** Did the selected adapter's own anchor for that region resolve? */
  readonly regionResolved: boolean;
  /** What the extraction read out of it — zero means it read nothing. */
  readonly extractedCount: number;
}

/**
 * CONTAINER corroboration — the tier {@link contradictsEmptyExtraction} names
 * as its complement, written out for a region the upstream scope check cannot
 * speak for.
 *
 * The cardinal tier consults a number the page rendered.  Post-detail's
 * engagement counters have no such second number: they ARE the extraction, so
 * there is no list beside them to contradict.  What there is instead is the
 * ROW they render in, and whether the selected adapter's own declared anchor
 * for it resolved:
 *
 * - region absent — nothing rooted the read, and on the only pages anyone has
 *   measured that is what a post with no engagement looks like.  Legitimately
 *   empty; return normally.  This is the case that keeps the check off every
 *   ordinary zero-engagement post, and it is why this is corroboration rather
 *   than a blanket "empty means broken".
 * - region present, read empty — the row LinkedIn renders only when it has
 *   something to render rendered nothing this parse could read.  The two
 *   halves of one observation contradict each other, so the record is not
 *   evidence the post has no engagement; it is evidence the counter patterns
 *   no longer match what the row says.  Raise.
 *
 * **What the second bullet rests on, stated because it is the whole warrant.**
 * Two captured legacy post-detail pages are committed, and they measure the
 * row in both directions: `socialCounts: 1` rendering `"2 41 comments"` beside
 * two reactions and forty-one comments, and `socialCounts: 0` rendering `""`
 * beside neither (`linkedin/__fixtures__/legacy/*.measured.json`, asserted
 * against the live DOM by `__tests__/fixture-oracle.integration.test.ts`).
 * Two pages is not a law, and a dialect that renders an empty counts row would
 * falsify it — which is exactly what the raise would report, pointing at the
 * counter patterns rather than at this premise.  The `sdui` adapter declares
 * `counts: []`, so `regionResolved` is unconditionally false there and this
 * tier never fires: the same recorded absence of measurement that field
 * already carries, now with a payoff for closing it.
 *
 * Split into a predicate and an assertion for the reason its sibling is: one
 * rule, one spelling, and a caller that needs the verdict before the raise can
 * read it without re-deriving the rule.
 *
 * @param observation - What was read, and whether its region rendered.
 * @returns Whether the region's presence contradicts an empty read.
 */
export function contradictsEmptyRegion(observation: {
  readonly regionResolved: boolean;
  readonly extractedCount: number;
}): boolean {
  // `!== 0` rather than the sibling's `> 0`, and the difference is load-bearing
  // in the same direction its comment argues.  There, every unusable value had
  // to fall through as "no contradiction"; here the guard runs the other way
  // round — it decides what counts as EMPTY — so a `> 0` test would send `NaN`
  // and negatives past it and let `regionResolved` alone decide, reporting a
  // parse regression somewhere upstream as a stale-counter diagnosis pointing
  // at these patterns.  A strict inequality against zero admits only a genuine
  // zero, which is the only reading that means "this read found nothing".
  if (observation.extractedCount !== 0) return false;

  return observation.regionResolved;
}

/**
 * Container corroboration as an assertion — {@link contradictsEmptyRegion}
 * plus the error it warrants.  The rule itself lives on that predicate; this
 * is the only place it becomes a raise.
 *
 * @param observation - What was read, and whether its region rendered.
 * @throws {ExtractionFailedError} When the read is empty and the region's
 *   presence contradicts it.
 */
export function assertRegionCorroboration(observation: RegionObservation): void {
  if (!contradictsEmptyRegion(observation)) return;

  throw new ExtractionFailedError({
    surface: observation.surface,
    variant: observation.variant,
    field: observation.field,
    corroborator: `${observation.regionName}=rendered`,
  });
}
