---
type: scope-brief
date: 2026-08-31
workflow: /scope
slug: lhremote-dom-variant-tolerance
closes: [823, 824, 825]
items: [826, 827, 828, 829, 830, 831, 832, 833, 834, 835, 836, 837, 838, 839, 840, 841]
---

# Scope Brief: LinkedIn DOM Variant Tolerance

## What was scoped

`#823`, `#824` and `#825` turned out to share one root cause, so they were scoped together as a
single migration rather than three fixes. **16 tracked items, #826–#841**, milestone
*LinkedIn Content Interaction*.

## What the investigation actually found

The filed cause — *"LinkedHelper 2.130.28 broke it"* — is **falsified**. It reproduces on 2.130.29,
a version the issue never names.

LinkedIn is serving **legacy pre-SDUI markup again**. Commit `15f5902` (*Closes #800*) rewrote the
post-detail scrapers for SDUI and left no legacy path, so `[componentkey]` and `[data-testid]` now
match **zero** elements document-wide, while the readiness cascade falls through to
`document.querySelector('main')` — which always exists.

Measured live on a fully-loaded 589 KB page: every scraper selector **0**, gate anchors **85** and
**82**, and `get-post` returning `text: ""` and `comments: []` alongside `commentCount: 41`.

The investigation expected a migration *forward* to a newer scheme. The truth was a flip **back** to
the older one — so the fix is not "chase the new selectors", it is "speak both, and bind the gate to
whichever one you are speaking".

## The two structural defects

1. **The readiness gate is not bound to the scraper it gates.** `wait-for-post-load.ts` documents its
   anchor as chosen because it *"still renders post-2026-05 markup refresh"* — selected for
   **surviving markup change**. Right for a liveness probe, catastrophic for a gate guarding
   variant-specific extraction: *a gate anchor that survives every markup change cannot detect a
   markup change.*
2. **The system cannot tell "legitimately empty" from "extraction failed."** Both render as success
   with empty fields, so silent data loss is indistinguishable from a true negative.

Fixing the selectors treats the symptom; this would be the third re-derivation (#776, #800, now
#823). ADR-007 already states the selector half-life is weeks-to-months, so there **will** be a
fourth — the goal is that it lands as a caught regression, not silent data loss.

## Key decisions

| Decision | Why |
|---|---|
| Detect the variant per page, dispatch to one adapter | Drift is non-monotonic (forward in May, backward in August) and possibly per-session A/B — so variant cannot be a build constant, config flag, or dated migration |
| **Reject** per-field selector fallback | "Empty ⇒ try the next selector" makes empty indistinguishable from failure — it would re-implement the bug while looking like the fix |
| **Reject** extending the comma-separated selector unions | A union cannot report *which* dialect it matched, so it can build a record from two dialects with no way to notice |
| Corroborated emptiness — cardinal + container | Makes "image-only post has no text" legal while "text missing because selectors are stale" is loud |
| Three error classes, not one | *"LinkedIn changed, register an adapter"*, *"this adapter is partially stale"* and *"two adapters matched — transitional page, fail loud rather than pick"* need different responses |
| ADR-008 reclaims post-detail; ADR-007 untouched | ADR-007 is `Accepted`, decides profile readiness only, has 14 live citers. The defect was `wait-for-post-load.ts` **borrowing** it for a surface it never claimed |
| Four fixtures, not one | The two middle ones are the only Tier-2 evidence that a legal empty stays legal |

## Corrections made during scoping

- **"Six unit tests to invert" was wrong.** Per-test adjudication against the real fixtures: **three
  invert, two are already the mandated GREEN controls and must survive untouched, one is held**
  pending the modal spike. An executor told "invert the six" would delete the only safeguards against
  an always-throw-on-empty regression.
- **AC-13 stated a false binary** (extend-or-supersede ADR-007). Amended.
- **`search-posts.ts` was missed** by the first decomposition pass. Caught by the coverage gate,
  verified SDUI-anchored at HEAD, filed as **#841**.

## Start here

**#827 — the pre-authored oracle.** Everything on the critical path waits on it, and it must be
authored independently of the fix (work class `deterministic-output`).

Runnable in parallel today: **#826** (commit the design artifacts), **#828** (harvest fixtures —
time-sensitive while the legacy variant is live), **#829** (E2E preconditions), **#830** (the modal
spike — needs your live account).

## Open, non-blocking

- **#830** answers whether the reactions modal has a container tier. The architecture degrades to
  cardinal corroboration either way, so it gates only the engagers half of #823.
- Whether the variant flip also hit **profile** pages is unprobed. Aria-label anchors are more
  flip-resilient than the `componentkey` attributes that vanished, so it is *plausibly* fine — an
  inference, not a measurement, and outside the ratified scope.
- **#569** edits `comment-on-post.ts` concurrently; **#609** raises the branch threshold while this
  adds branches. Both noted on the affected items.

## Artifacts

| Artifact | Path |
|---|---|
| PRD | `docs/requirements/linkedin-dom-variant-tolerance-prd.md` |
| Solution design | `docs/design/linkedin-dom-variant-tolerance-solution-design.md` |
| Design brief | `docs/design/linkedin-dom-variant-tolerance-brief.md` (`status: final`) |
| Live probe | `linkedin/post-detail-dom-legacy-reversion-20260831.md` in the **private** research repo — measurements restated in-band here and in every work item |
| Investigation | session scratch, superseded by the PRD and solution design above; not committed |

Every issue body carries its context **in-band** and cites these paths as provenance only. That was
written while the `docs/` artifacts were still untracked (#826 committed them), and it stays true for
a stronger reason: the DOM probe lives in a **private** repo, so no public reader can follow that
link. In-band context is what makes #827–#841 executable by someone who can reach neither.
