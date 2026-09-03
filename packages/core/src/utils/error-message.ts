// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * How many causes are rendered before the walk stops.
 *
 * Deep enough for every chain this codebase builds today (the longest is
 * two: a service error wrapping a CDP error wrapping the fetch failure),
 * with headroom for a consumer that nests further.  A bound is required
 * rather than nice to have: `cause` is `unknown`, so a chain's depth is not
 * this package's to control, and an unbounded walk turns one caught error
 * into an unbounded write to stderr.
 *
 * This counts causes RENDERED, not links followed — a link the rules below
 * skip must not spend an operator's budget on text they never saw.
 */
const MAX_CAUSES_RENDERED = 5;

/**
 * How many links are followed before the walk stops, whatever it rendered.
 *
 * The companion bound to {@link MAX_CAUSES_RENDERED}: that one bounds the
 * OUTPUT, this one bounds the WORK, and a chain whose links are all skipped
 * would otherwise walk to its end no matter how short the output stayed.
 */
const MAX_LINKS_FOLLOWED = 25;

/**
 * Longest single cause rendered before it is elided.
 *
 * Sized against the longest cause the codebase actually produces — the
 * search-results zero-match cause, which spells out both readings of a zero
 * match and measures 448 characters — with better than 2x headroom.
 *
 * This bounds the OUTPUT; it is not a privacy control and must not be read
 * as one.  Truncating page content would still print page content.  What
 * keeps page content off this surface is the invariant stated on
 * {@link errorMessage}: a `cause` carries a diagnosis, never a scrape.
 */
const MAX_CAUSE_LENGTH = 1000;

/** Shown in place of the causes a bound stopped the walk before reaching. */
const OMISSION_NOTE = "Caused by: … (further causes omitted)";

/**
 * Render one link of a chain — its own text, without following its `cause`.
 *
 * Mirrors the rule the top-level value has always been rendered by, so a
 * cause and the error carrying it are treated identically.
 *
 * **Total by construction.**  `String()` throws on a value with no
 * `toString` (`Object.create(null)`) or a throwing one, and a `message`
 * getter may throw too.  Before this walked the chain, the only value ever
 * stringified was one the caller already held, so a throw here was the
 * caller's own; now it would be raised from *inside a catch block at the
 * process boundary* — the CLI handler and `mcpCatchAll` both call this while
 * handling a failure, and a formatter that throws there destroys the report
 * instead of writing it.  An unreadable link therefore renders as no text,
 * which the caller already treats as nothing to show.
 */
function ownText(value: unknown): string {
  try {
    return value instanceof Error ? value.message : String(value);
  } catch {
    return "";
  }
}

/** Read a link's `cause`, tolerating a getter that throws. */
function causeOf(value: unknown): unknown {
  if (!(value instanceof Error)) return undefined;
  try {
    return value.cause;
  } catch {
    return undefined;
  }
}

/**
 * Bound a single cause's contribution to the rendered output.
 *
 * Cuts on a character boundary: `length` counts UTF-16 code units, so a
 * blind slice can keep the leading half of a surrogate pair and emit a lone
 * surrogate, which reaches the operator as a replacement glyph.
 */
function elide(text: string): string {
  if (text.length <= MAX_CAUSE_LENGTH) return text;
  const last = text.charCodeAt(MAX_CAUSE_LENGTH - 1);
  const isLeadingHalf = last >= 0xd800 && last <= 0xdbff;
  return `${text.slice(0, isLeadingHalf ? MAX_CAUSE_LENGTH - 1 : MAX_CAUSE_LENGTH)}…`;
}

/**
 * Extract a human-readable message from an unknown caught value, including
 * the diagnosis carried by its `cause` chain.
 *
 * **Why the chain and not just the message.**  ADR-005 § Decision 4 makes
 * every error in the hierarchy accept `ErrorOptions`, and the DOM
 * variant-tolerance work put the real diagnosis there: the readiness gates
 * attach per-registered-adapter detect probe counts, which are what tell an
 * operator whether *no* adapter matched (LinkedIn changed its markup —
 * register an adapter), *two* matched (a hybrid page — tighten the detect
 * anchors), or exactly one matched (that adapter's field selectors went
 * stale).  The search-results gate additionally names both readings of a
 * zero match there, because its error class's own wording over-claims on
 * that surface.  Rendering only `.message` discarded all of it at the
 * process boundary: an in-process consumer and a Node stack trace saw the
 * chain, a CLI user and an MCP agent did not — and an MCP agent is the
 * least able party to diagnose a stale selector, which is the reason
 * ADR-008 § Decision 5 requires the error to name the variant and the field
 * at all.  The DOM variant errors reach both surfaces through this one
 * function, so this is where the last hop belongs.  (Not *every* operator
 * path renders through here: a handful of CLI branches and the three
 * classes `mapErrorToMcpResponse` maps by hand read `.message` directly.
 * None of those classes is ever constructed with a `cause` today, so
 * nothing is lost on them — but they are not covered by this, and a cause
 * added to one later would not travel.)
 *
 * **What is rendered.**  The value's own text, then one `Caused by:` line
 * per link of the chain:
 *
 * ```text
 * No DOM adapter matched the post-detail page (tried: sdui, legacy). …
 * Caused by: detect probes — sdui: 0, legacy: 0
 * ```
 *
 * Rules that keep that bounded and free of noise:
 *
 * - **Two bounds**, {@link MAX_CAUSES_RENDERED} on the output and
 *   {@link MAX_LINKS_FOLLOWED} on the work.  Either one stopping the walk
 *   early appends {@link OMISSION_NOTE}, so a truncated chain says so
 *   rather than ending silently.  The note deliberately carries no count:
 *   causes rendered and links followed differ whenever a link is skipped,
 *   and a number that could mean either is worse than no number.
 * - **A cycle** (`a.cause = b; b.cause = a`) ends the walk.  Chains are
 *   built by callers, so nothing guarantees one is acyclic.
 * - **Length** per cause stops at {@link MAX_CAUSE_LENGTH}.
 * - **Text already rendered is not rendered twice.**  The prevailing wrap
 *   idiom in this codebase interpolates the *rendered* cause into the
 *   wrapper's own message — ``const message = errorMessage(error)`` then
 *   ``new CampaignExecutionError(`Failed to …: ${message}`, id, { cause:
 *   error })`` — so a naive walk would print the whole chain once in the
 *   head and again line by line.  A cause whose text already appears in the
 *   text rendered immediately above it is therefore skipped.  Three details
 *   earn their keep: the comparison is against the rendered *text* and
 *   never the `Caused by: ` decoration around it, or a cause colliding with
 *   that decoration would vanish; it is against the *un-elided* text, or a
 *   cause longer than the bound would stop matching the head that already
 *   contains it and print twice; and it is against the text *immediately
 *   above* rather than everything rendered so far, or a link that merely
 *   repeats a distant ancestor — the same condition observed at two layers,
 *   which is information — would be dropped.  The rule stays deliberately
 *   textual: it cannot know the wrapper's intent, so a short generic cause
 *   that happens to be a substring is dropped.  That trade favours the
 *   diagnostic causes this exists for, which are long and specific, over
 *   the ones it would lose, which are neither.
 *
 * **Page content stays out.**  Diagnostic bundles carry page content and are
 * written to disk only behind `LHREMOTE_CAPTURE_DIAGNOSTICS=1`, because that
 * content is personal data.  This function is not a way around that gate and
 * must not become one: it renders only what a `cause` already holds, and no
 * `cause` constructed in this codebase holds a scrape — the readiness gates
 * attach adapter names and probe counts, which is the diagnosis and not the
 * page.  That is a property of the producers, not something checked here,
 * and one producer is worth naming: `CDPEvaluationError` carries the
 * `exceptionDetails` description of a script that threw *inside the page*,
 * and service wrappers forward it as a `cause`.  Today the injected sources
 * throw fixed strings, so nothing page-derived travels; a source that
 * interpolated page text into a thrown message would publish it here with
 * no gate in front of it.  Attach page content to a bundle, never to a
 * `cause`.
 *
 * @param error - Any caught value.
 * @returns The message, plus a `Caused by:` line per rendered cause.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return ownText(error);

  // The head is normalized on the same terms as a cause.  It used to be the
  // whole output, so its surrounding whitespace was invisible; now a second
  // line follows it and a trailing newline shows up as a blank one.
  const head = ownText(error).trim();
  const lines = head.length > 0 ? [head] : [];

  // What the already-rendered rule compares against: the text of the last
  // thing shown, undecorated and un-elided.
  let previous = head;
  let rendered = 0;
  let followed = 0;
  const seen = new Set<unknown>([error]);
  let current = causeOf(error);

  while (current !== undefined && current !== null && !seen.has(current)) {
    if (followed === MAX_LINKS_FOLLOWED) {
      lines.push(OMISSION_NOTE);
      break;
    }
    seen.add(current);
    followed++;

    const text = ownText(current).trim();
    if (text.length > 0 && !previous.includes(text)) {
      if (rendered === MAX_CAUSES_RENDERED) {
        lines.push(OMISSION_NOTE);
        break;
      }
      lines.push(`Caused by: ${elide(text)}`);
      previous = text;
      rendered++;
    }

    current = causeOf(current);
  }

  return lines.join("\n");
}
