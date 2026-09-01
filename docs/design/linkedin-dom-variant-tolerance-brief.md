---
type: design-brief
date: 2026-08-31
source: linkedin-dom-variant-tolerance-solution-design.md
workflow: /design-solution
status: final
---

# Design Brief: LinkedIn DOM Variant Tolerance and Fail-Loud Extraction

## Problem

`get-post`, `get-post-engagers` and `get-feed` return HTTP-success payloads with empty content on
posts that visibly have content. The filed cause (a LinkedHelper version) is falsified: LinkedIn
flipped its post-detail markup **back** to the pre-SDUI dialect, our scrapers speak only SDUI, and
the readiness gate falls through to `document.querySelector('main')` — which always exists. Gate
green, scrape empty, success returned. The deeper problem is that the gate is not bound to the
scraper it gates, and the system cannot tell "legitimately empty" from "extraction failed."

## Key Decisions

1. **Detect the variant per page, then dispatch to one adapter** — because LinkedIn's drift is
   *non-monotonic* (SDUI-forward in May, legacy-backward in August) and possibly per-session A/B, so
   variant cannot be a build constant, a config flag, or a dated migration.
2. **Reject per-field selector fallback**, though it is the intuitive fix — "empty ⇒ try the next
   selector" makes empty indistinguishable from failure, which would re-implement the bug while
   looking like a repair.
3. **Reject extending the existing comma-separated selector unions** — a union cannot report *which*
   dialect it matched, so it can produce a record whose fields came from two different dialects with
   no way to notice.
4. **Corroborated emptiness** — an empty result is trustworthy only if a same-observation signal
   agrees. Two corroborator kinds: *cardinal* (a count in the same response) and *container* (did
   the region's anchor match?). The container kind is what makes "image-only post has no text" legal
   while "text missing because selectors are stale" is loud.
5. **Two new error classes, not one** — `DOMVariantUnsupportedError` ("LinkedIn changed, register an
   adapter") and `ExtractionFailedError` ("this adapter is partially stale, fix that field"). They
   demand different operator responses; collapsing them discards the most useful new signal.
6. **ADR-008 reclaims the post-detail citations; ADR-007 stays untouched** *(ratified)* — the PRD's
   AC-13 offered a false binary and has been amended. Grounding the artifact showed ADR-007 is
   `Accepted`, decides profile/company readiness only, and has **14 live citation sites**. It is
   neither outdated nor superseded, so the standing "delete and replace superseded ADRs" policy —
   adopted and recorded — does not fire on it. The defect was never ADR-007; it was
   `wait-for-post-load.ts` *borrowing* it for a surface it never claimed.
7. **Three migration tiers across the ten files, not a uniform rewrite** — five of the ten are
   action files with no empty-vs-error question and get an import-site change only. This also keeps
   `comment-on-post.ts` rebase-clean under the concurrent `#569`.

## The finding that reframed the design

The readiness gate was **optimized for exactly the wrong property**. `wait-for-post-load.ts`
documents its author-link anchor as chosen because it *"still renders post-2026-05 markup refresh"*
— it was selected for **surviving markup change**. That is right for a liveness probe and
catastrophic for a gate gating variant-specific extraction:

> A gate anchor that survives every markup change cannot detect a markup change.

It matched 85 elements on the page where every extraction selector matched 0. The gate did not
malfunction — it did exactly what it was built to do, and that was never what the scrapers needed.

## Design Tracks

| Track | Approach | Key trade-off |
|---|---|---|
| Technical Architecture | Adapter registry keyed on `(Surface, DOMVariant)`; detection → gate → extract → corroborate | Adds an abstraction layer to buy FR-3 structurally rather than by discipline |
| Integration | LinkedIn's DOM treated as an unversioned, non-monotonic external system | Assumes drift recurs — the alternative assumes it does not, which ADR-007 already contradicts |
| API Design | Two typed errors; CLI `exit 1`, MCP `isError: true` | A live behavior flip on a released product, accepted deliberately |
| Security (narrow) | Scrub third-party PII **inside** the harvest tooling | An unscrubbed fixture never reaches the working tree; costs harvest complexity |
| Testing Architecture | T1-heavy pyramid; a **four-fixture** T2 oracle is the only tier that can catch a flip pre-merge | E2E cannot gate merges (ADR-004), so the fixtures carry the load |

## Open Questions

- **Does the reactions modal have a container tier?** Context: the modal was never probed — opening
  it exceeds a read against a live licensed LinkedIn account, so the investigation stopped short.
  Impact if deferred: blocks the `get-post-engagers` half of #823 and leaves one existing unit test
  undecidable. Mitigated: the architecture degrades to cardinal corroboration either way, so this
  does **not** block the main line. **→ filed as #830**, 2-hour time-box, needs your live account.

- **One error class or two?** Non-load-bearing. Two recommended; collapsible later without redesign.

- **Re-point two out-of-scope ADR-007 citations?** Non-load-bearing. `wait-for-reactions-modal.ts`
  and some post-detail unit-test comments cite ADR-007 for post-detail; they sit outside the
  ratified ten files and the change is comment-only. Flagged rather than absorbed.

### Resolved this round

- ~~**Amend AC-13?**~~ **Resolved.** Amended: ADR-008 reclaims the post-detail citations, ADR-007
  stays `Accepted` and in force. Your "no superseded ADRs in the tree" policy is adopted and
  recorded — it does not fire here because nothing is superseded (checked: status `Accepted`,
  14 live citers, zero superseded ADRs currently in tree).
- ~~**Ratify PEND-3?**~~ **Resolved — four fixtures.** Defect page, zero-comment, image-only, SDUI
  control. The two middle ones are the only Tier-2 evidence that a legal empty stays legal.

## Status

**`final`.** The two remaining load-bearing questions (OQ-1 and OQ-2 — one probe) were converted to
a tracked item, **#830**, and the architecture is robust to either answer: corroboration degrades to
the cardinal kind if the modal has no container tier. They therefore no longer block, which is the
Open-Questions Lock Gate resolving rather than being waived.

Still open and non-blocking: one error class vs two (#832 takes two), and two comment-only ADR-007
citations outside the ratified file list.

Not run: the dual-lens ratification. The session's operating instructions forbid dispatching agents
unless you ask, and the UX lens has no subject here (no user-facing interface). Recorded as not-run
rather than claimed as passed.

## Full Design

See [linkedin-dom-variant-tolerance-solution-design.md](linkedin-dom-variant-tolerance-solution-design.md).
