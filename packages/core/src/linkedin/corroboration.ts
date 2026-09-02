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
 * and on the post-detail surface it is already enforced upstream: an adapter
 * that cannot resolve its own scope yields no record at all and raises
 * `DOMVariantUnsupportedError`. The two tiers are deliberately not collapsed
 * into one — a single "empty implies stale" rule false-positives on every
 * image-only and link-only post.
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
