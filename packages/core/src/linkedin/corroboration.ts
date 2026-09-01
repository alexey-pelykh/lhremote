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
 * @param observation - What was extracted, and the count to consult.
 * @throws {ExtractionFailedError} When the extraction is empty and the
 *   cardinal contradicts it.
 */
export function assertCardinalCorroboration(
  observation: CardinalObservation,
): void {
  if (observation.extractedCount > 0) return;

  // Written as `!(cardinal > 0)` rather than `cardinal <= 0` so that the one
  // predicate covers every value that is not a positive count: zero (the legal
  // empty this whole check exists to preserve), a negative, and `NaN`. The last
  // is why the inverted form is load-bearing — `NaN <= 0` is `false`, so the
  // `<= 0` spelling falls through and reports `commentCount=NaN`, which is a
  // parsing regression somewhere else surfacing as a stale-selector diagnosis
  // pointing at this field. Both current producers already coerce a failed
  // parse to 0, so this is defence in depth rather than a live path.
  if (!(observation.cardinal > 0)) return;

  throw new ExtractionFailedError({
    surface: observation.surface,
    variant: observation.variant,
    field: observation.field,
    corroborator: `${observation.cardinalName}=${String(observation.cardinal)}`,
  });
}
