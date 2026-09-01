---
type: solution-design
slug: linkedin-dom-variant-tolerance
date: 2026-08-31
workflow: /design-solution
source: docs/requirements/linkedin-dom-variant-tolerance-prd.md
status: final
---

# Solution Design: LinkedIn DOM Variant Tolerance and Fail-Loud Extraction

Satisfies `docs/requirements/linkedin-dom-variant-tolerance-prd.md`
(`dor_status: passed-with-findings`). Baseline HEAD `fad665d`.

---

## 1. Goals and Drivers

1. **Extract correctly under any markup dialect LinkedIn serves** (FR-1, FR-5, FR-6).
2. **Never return a self-contradictory empty payload as success** (FR-7, FR-8) — while **never
   erroring on a legitimately empty result** (FR-9). These two are a *paired* constraint.
3. **Make the next variant flip a caught regression rather than silent data loss** (FR-11, FR-12).
4. **Make adding a third dialect cheap** (FR-2, NFR-4) — because ADR-007 already states the
   selector half-life is weeks-to-months, so there *will* be a third.

## 2. Constraints

- **CON-1** — Track B alone is a live behavior flip on a released product (`0.20.1`): CLI `exit 1`,
  MCP `isError: true` where callers previously got success.
- **CON-2** — Work class `deterministic-output`. The Tier-1 assertions encoding the new contract are
  **pre-authored**, independently of the implementation.
- **CON-3** — ADR-004: T1 + T2 run in CI, **T3 E2E never does**. No E2E assertion can gate a merge.
- **CON-4** — Project directives (branch-per-change, commit format, `Closes #N`, `pnpm lint`,
  Copilot cycle, explicit E2E preconditions, shared helpers from `@lhremote/core/testing`).
- **CON-5** *(discovered here)* — `#569` concurrently edits `comment-on-post.ts:93-106`.

---

## 3. Context and Scope

The external system is **LinkedIn's rendered DOM**, reached through LinkedHelper's Electron
instance over CDP. It is:

- **Unversioned** — no contract, no changelog, no deprecation window.
- **Non-monotonic** — it moved SDUI-forward on 2026-05-06 and **legacy-backward** by 2026-08-31.
  This design's single most important assumption is that *drift is not a one-way migration*.
- **Possibly per-session** — the observed legacy serving may be an A/B bucket, so two accounts may
  see two dialects **at the same moment**.

That last point is decisive for the architecture: variant cannot be a build-time constant, a
config flag, or a dated migration. It must be **detected per page, at runtime**.

**In scope**: the ten operation files, the readiness helper, the selector registry, the Tier-1/2
test surface, two E2E files, one new ADR.
**Out of scope**: the CDP transport (ADR-002), the operations layer shape (ADR-006), proactive
monitoring of LinkedIn markup, `#569`, `#609`.

---

## 4. Solution Strategy

### 4.1 The finding that reframes the problem

Reading the existing code changed the design. Two things are already true in the repo:

**(a) `selectors.ts` already documents a two-stack world** and already handles it with
comma-separated selector lists:

> *"LinkedIn currently serves two different frontend stacks: Feed page (`/feed/`) — CSS modules …
> Post page (`/posts/…`) — Legacy Ember.js … All selectors use CSS selector lists (comma-separated)
> to match both variants where they differ."*

But that comment describes a **surface** axis (feed page vs post page), not a **temporal** axis
(SDUI vs legacy *for the same surface*). The extraction rewrite in `15f5902` collapsed the second
axis to a single value. **There are two orthogonal axes and the codebase models only one.**

This also exposes a live hazard in the existing approach: a comma-separated union that spans
*both* axes can match a feed-page selector while standing on a post page. Union-by-comma has no
way to say *which* dialect it matched, so it cannot detect that it matched the wrong one.

**(b) The readiness gate was optimized for exactly the wrong property.**
`wait-for-post-load.ts` documents its author-link anchor as chosen because it *"still renders
post-2026-05 markup refresh"* — i.e. it was selected for **surviving markup change**. That is the
correct property for a liveness probe and the *catastrophically wrong* property for a gate that
guards variant-specific extraction:

> **A gate anchor that survives every markup change cannot detect a markup change.**

`main a[href*="/in/"]` matched **85** elements on the page where every extraction selector matched
**0**. The gate did not malfunction. It did precisely what it was designed to do, and what it was
designed to do was never what the scrapers needed.

This is why FR-3 (*the gate anchors on the same adapter that will extract*) is the structural fix
and `main` removal (FR-4) is only its most acute symptom.

### 4.2 Approach selection

Four candidates were generated before converging.

| # | Approach | Verdict |
|---|---|---|
| **A1** | **Selector union** — extend the existing comma-separated lists to the extraction selectors | **Rejected.** Variant identity is never modeled, so a page can match SDUI for the container and legacy for comments and produce a **chimera** record with no way to notice. Extension cost is *every call site* (violates FR-2/NFR-4). And it cannot satisfy FR-3: there is no "the adapter that will extract" to bind the gate to |
| **A2** | **Detect variant per page → dispatch to one adapter** | **SELECTED** |
| **A3** | **Probe-and-score** — every adapter self-reports a confidence, highest wins | **Rejected on parsimony.** A tuned threshold is a new knob whose mis-tuning reintroduces exactly the silent-wrongness class this design exists to remove. Its *insight* is kept: detection must be decisive and observable |
| **A4** | **Per-field fallback** — try selectors until one yields non-empty | **Rejected, and recorded because it is the intuitive move.** "Empty ⇒ try the next one" makes empty indistinguishable from failure — the exact inverse of FR-7. A4 would *re-implement the bug* while looking like a fix |

**A2 rationale**: it is the only candidate under which FR-3 falls out structurally rather than
being bolted on — once one adapter governs a page, "the gate anchors on the extracting adapter" is
a tautology instead of a discipline someone must remember.

### 4.3 Corroborated emptiness

Track B's discriminator generalizes to one concept: **an empty extraction is only trustworthy if
something else in the same observation corroborates it.** Two corroborator kinds, and the
distinction resolves scope item 11 and OQ-2:

| Kind | Corroborator | Empty is legal when | Empty is a failure when |
|---|---|---|---|
| **Cardinal** | a count from the same response (`commentCount`, `totalReactions`) | count is `0` | count is `> 0` |
| **Container** | did the adapter's own container anchor match? | container matched (post genuinely has no text) | container did **not** match |

`text: ""` uses the **container** corroborator — which is exactly why AC-9b (a matched container
with `text: null` yields `""` and does not throw) is satisfiable at all, and why the unamended
AC-1a false-positived on every image-only and link-only post: it had no container tier to consult.

**This is what makes the design robust to OQ-1/OQ-2.** If the reactions modal turns out to have a
container tier, it uses container corroboration; if it does not, it falls back to the cardinal
corroborator it already has (`totalReactions`). The architecture does not need the answer.

---

## 5. Building Blocks

### 5.1 New concepts

```text
DOMVariant          "sdui" | "legacy" | …            open set, string-keyed, not a boolean
Surface             "post-detail" | "feed" | "search" | "reactions-modal"
VariantAdapter      (Surface, DOMVariant) -> {
                      detect:     a decisive anchor proving THIS dialect is present
                      ready:      the readiness anchor — MUST come from this adapter
                      extract:    the field selectors + parsing for this dialect
                      container:  per-field container anchors (the corroborator)
                    }
AdapterRegistry     Surface -> VariantAdapter[]        the ONE place a new dialect registers
ExtractionOutcome   complete | legitimately-empty | failed(reason)
```

`VariantAdapter` is keyed on the **pair**, which is what separates the two axes § 4.1 found
conflated. `selectors.ts` becomes the registry's data, not a flat list of unions.

### 5.2 Control flow

```text
navigate
  │
  ├─ detect ──── for each adapter registered for this Surface, evaluate its detect anchor
  │              exactly one match  → selected
  │              zero matches       → DOMVariantUnsupportedError      (FR-4)
  │              two or more        → DOMVariantAmbiguousError, diagnostics captured
  │
  ├─ ready ───── poll the SELECTED adapter's readiness anchor           (FR-3)
  │              deadline expires   → ExtractionTimeoutError (typed)    (FR-8)
  │
  ├─ extract ─── run the selected adapter's field extractors
  │
  └─ corroborate ── per field, consult its corroborator                 (FR-7 / FR-9)
                    empty + corroborated  → legitimately-empty → return normally
                    empty + contradicted  → failed → ExtractionFailedError + diagnostics
                    non-empty             → complete → return
```

**There is no terminal fallback.** The `zero matches` branch is a first-class outcome, not a
default. That is FR-4 expressed structurally: there is no line to accidentally re-add `main` to,
because the cascade has been replaced by a registry lookup that can legitimately return nothing.

### 5.3 Migration shape for the ten files

Three tiers, deliberately unequal — a uniform rewrite of all ten would be the Redesign Trap:

| Tier | Files | Change |
|---|---|---|
| **Full adapter** | `get-post.ts`, `get-feed.ts`, `wait-for-post-load.ts`, `selectors.ts` | Detection, gate binding, extraction, corroboration |
| **Registry consumer** | `search-posts.ts`, `get-post-engagers.ts` | Use the registry; corroboration where a corroborator exists |
| **Selector-sourced only** | `comment-on-post.ts`, `react-to-comment.ts`, `dismiss-feed-post.ts`, `hide-feed-author.ts`, `unfollow-from-feed.ts` | Read selectors from the registry instead of module constants. **These are action files, not extraction files** — they have no empty-vs-error question, so track B does not touch them |

Tier 3 is the collision-avoidance lever for CON-5: `comment-on-post.ts` receives a mechanical
import-site change only, which rebases cleanly under `#569`.

---

## 6. Runtime View

**Sequence — the defect, before and after.**

```text
BEFORE (observed live 2026-08-31)
  navigate → readiness: main a[href*="/in/"] → 85 matches → READY
           → extract:   [componentkey…]      →  0 matches → {}
           → return     {text:"", comments:[], commentCount:41}   HTTP 200 ✅  ← silent loss

AFTER
  navigate → detect:    sdui anchor    → 0
                        legacy anchor  → 1                   → variant = legacy
           → readiness: legacy adapter's own anchor          → READY
           → extract:   .update-components-text → 41 matches
           → corroborate: commentCount 41 vs comments 41     → complete
           → return     {text:"Monday starts with a test", comments:[…41]}   ✅

AFTER, if LinkedIn serves a THIRD dialect
           → detect:    sdui 0, legacy 0                     → no adapter
           → DOMVariantUnsupportedError + diagnostics         ❌ loud, diagnosable, actionable
```

---

## 7. Interface Contracts (API Design track)

### 7.1 Error taxonomy (FR-8)

Three *distinct* new subclasses, because they demand different operator responses:

| Class | Extends | Fires when | Operator action |
|---|---|---|---|
| `DOMVariantUnsupportedError` | `ServiceError` | No registered adapter matched the page | **LinkedIn changed.** Register a new adapter |
| `ExtractionFailedError` | `ServiceError` | An adapter matched, but a field's emptiness is contradicted by its corroborator | **This adapter is partially stale.** Repair that field's selectors |
| `DOMVariantAmbiguousError` | `ServiceError` | Two or more adapters matched the same page (§ 5.2; risk **R-9**) | **Transitional or hybrid page.** Fail loud rather than pick — inspect the diagnostics and tighten the detect anchors |

Collapsing these into one class would discard the most useful bit of information the system now
has. Existing classes were considered and rejected: `ExtractionTimeoutError` is wrong (nothing
timed out — that is the whole point), `CDPEvaluationError` describes the evaluate *call* failing
rather than its result being wrong, and `ActionExecutionError` is too generic to route on.

`wait-for-post-load.ts`'s existing plain `Error` becomes `ExtractionTimeoutError`, closing the
confirmed ADR-005 conformance gap.

### 7.2 Surface impact (CON-1)

| Surface | Before | After |
|---|---|---|
| Library | resolves with empty fields | throws a typed error |
| CLI | exit `0`, empty JSON | exit `1`, error on stderr |
| MCP | `isError: false`, empty content | `isError: true`, message names the variant and the field |

The MCP message **must name the variant and the field**, because an agent consuming this tool is
the least able party to diagnose it.

---

## 8. Crosscutting Concepts

### 8.1 Security (narrow track — the fixture is the whole surface)

FR-11 harvests a **real LinkedIn page** into a **public AGPL repository**. That page carries third
parties' names, profile URLs, avatar URLs, and comment text. The live probe already read 40
comment entities and a named first commenter.

**Scrub requirement (PRD PEND-2, promoted here to a design constraint):**

| Class | Treatment |
|---|---|
| Third-party names, headlines, profile URLs, member URNs | Replaced with synthetic values, **structurally identical** (same shape, same length class) so selectors still exercise |
| Avatar / media URLs | Replaced with `data:` or local placeholders — **no outbound fetch from a test** |
| Comment text | Replaced with lorem of comparable length |
| Author (repo owner's own post) | May be retained — it is the maintainer's own content |
| Session tokens, `csrf-token`, cookies, `<script>` payloads | **Stripped entirely** — these can appear in serialized SDUI state |

The scrub is **not** a post-hoc cleanup: it runs in the harvest tooling, so an unscrubbed fixture
is never written to disk in the working tree.

### 8.2 Observability (FR-10)

Diagnostics capture is currently timeout-gated, which makes project directive 8 undischargeable for
this exact defect class. The trigger widens from *"the deadline expired"* to *"an operation is
failing"*, which now includes both new error classes.

The capture adds one field the existing bundle lacks and that this design makes cheap: **the
detection probe results per registered adapter** (`sdui: 0, legacy: 0`). That single line is the
entire diagnosis for the next flip.

Activation stays gated on `LHREMOTE_CAPTURE_DIAGNOSTICS=1` (default-off for CLI/MCP, on for E2E) —
unchanged, and correct: the artifacts contain page content, i.e. personal data.

### 8.3 Error handling across boundaries

Both new classes cross library → CLI/MCP unchanged in *kind*; only the mapping to exit code and
`isError` is new (§ 7.2).

### 8.4 Performance

Detection adds N selector evaluations per page (N = adapters registered for the surface, currently
2), on a path that already does a multi-second readiness poll. Immaterial. Detection runs **once**
per operation and its result is passed down, never re-probed per field.

---

## 9. Architecture Decisions

### ADR-008 — Surface-agnostic readiness/extraction binding (new)

**Status: RESOLVED 2026-08-31 (user-ratified).** The PRD's AC-13 offered a false binary
(*extend ADR-007 to post-detail, or supersede it*). AC-13 has been amended; the decision is:

> **Author a NEW ADR-008 stating the surface-agnostic invariant and the empty-vs-error contract.
> ADR-008 RECLAIMS the post-detail citations of ADR-007. ADR-007 itself stays `Accepted`,
> unmodified, and in force for profile and `/company/` pages.**

**Standing policy adopted**: *no outdated or superseded ADRs are kept in the tree — delete and
replace.* It is recorded here as binding on future ADR work, and it **does not fire on ADR-007**,
because grounding the artifact showed ADR-007 is neither outdated nor superseded:

| Check | Finding |
|---|---|
| Status | `Accepted` (2026-04-19, amended 2026-04-29 and 2026-05-05) — never superseded |
| What it decides | An `aria-label` disjunction for **profile/company page readiness** — not post-detail, not extraction |
| Still correct? | Yes for its own surface. Its rationale is that `aria-label` strings are *"i18n-anchored, not CSS-architecture-anchored"* and *"survive LinkedIn DOM redesigns that preserve accessibility semantics"* |
| Live citers | **14 sites** — `navigate-to-profile.ts`, `wait-for-post-load.ts`, `wait-for-reactions-modal.ts`, `e2e-helpers.ts`, `unfollow-profile.e2e.test.ts` (asserts its amended premise **by name**), `vitest.e2e.config.ts`, `CLAUDE.md`, plus unit tests |
| Superseded ADRs currently in tree | **zero** — there is no accumulated-cruft problem for the policy to solve |

**And the grounding sharpened this design's central claim.** ADR-007's strategy is *deliberately
variant-agnostic* — which is **correct for profile navigation**, where readiness means only "the
page hydrated", and **exactly wrong for post-detail**, where the gate must guard variant-specific
extraction. So the defect was never ADR-007. It was `wait-for-post-load.ts` **borrowing** ADR-007
for a surface ADR-007 never claimed, inheriting a property that is right there and catastrophic
here. ADR-008 reclaims exactly those borrowed citations and nothing else.

*Unverified, flagged not assumed*: whether LinkedIn's variant flip also affects **profile** pages is
unprobed. ADR-007's `aria-label` anchors are more flip-resilient than the `componentkey` attributes
that vanished, so profile readiness is *plausibly* unaffected — but that is an inference, not a
measurement, and it is **out of the ratified scope** to chase here.

What generalizes is not ADR-007's selectors but the **invariant they are an instance of**:

> A readiness gate must anchor on a selector belonging to the same adapter that will perform the
> extraction. An anchor chosen for surviving markup change cannot gate variant-specific extraction.

ADR-008 states that invariant, defines the `ExtractionOutcome` trichotomy and the corroborated-
emptiness contract normatively, and cites ADR-007 as its precedent instance on a different surface.

**Citation re-pointing scope**: `wait-for-post-load.ts` is on the ratified ten-file list, so its
three ADR-007 citations move with the work. `wait-for-reactions-modal.ts`, `CLAUDE.md`'s ADR table
and the post-detail unit-test comments are **not** on that list — adding an ADR-008 row to
`CLAUDE.md` is additive and covered by scope item 10; the other two are flagged in § 14 rather than
absorbed.

### ADR-009 — Error taxonomy extension (new, may be folded into ADR-008)

Records the two new `ServiceError` subclasses and why the existing classes were insufficient
(§ 7.1). Small enough that folding it into ADR-008 is acceptable; kept separate here so the
decision is visible.

---

## 10. Master Test Plan (Testing Architecture track)

### 10.1 Goals and Risk Surface — Google ACC

**Attributes**: Correct · Loud · Tolerant · Diagnosable · Extensible

| ID | Component | Capability | Attr | Risk |
|---|---|---|---|---|
| **Cap-1.1** | AdapterRegistry | Detects `legacy` on a legacy page | Correct | **H** |
| **Cap-1.2** | AdapterRegistry | Detects `sdui` on an SDUI page (no regression) | Correct | **H** |
| **Cap-1.3** | AdapterRegistry | Raises `DOMVariantUnsupportedError` when no adapter matches | Loud | **H** |
| **Cap-1.4** | AdapterRegistry | A third adapter registers without touching call sites | Extensible | M |
| **Cap-2.1** | ReadinessGate | Does **not** report ready when no adapter matches | Loud | **H** |
| **Cap-2.2** | ReadinessGate | Anchors on the selected adapter's own anchor | Correct | **H** |
| **Cap-3.1** | Corroborator | Empty + cardinal `> 0` → throws | Loud | **H** |
| **Cap-3.2** | Corroborator | Empty + cardinal `0` → returns normally | Tolerant | **H** |
| **Cap-3.3** | Corroborator | `text` empty + container matched → `""`, no throw | Tolerant | **H** |
| **Cap-3.4** | Corroborator | `text` empty + container **not** matched → throws | Loud | M |
| **Cap-4.1** | get-post | `commentCount` parses `"2 41 comments"` → `41` / `2` | Correct | M |
| **Cap-4.2** | get-feed | `authorName` / `authorProfileUrl` read from one element | Correct | M |
| **Cap-5.1** | Diagnostics | Capture fires on extraction failure, not only timeout | Diagnosable | M |
| **Cap-5.2** | Diagnostics | Capture records per-adapter detection results | Diagnosable | M |
| **Cap-6.1** | E2E | Preconditions asserted, never conditionally skipped | Loud | M |

### 10.2 Pyramid composition

| Tier | Runs in CI | Covers |
|---|---|---|
| **T1 unit** | ✅ | Cap-1.x, 2.x, 3.x, 4.x — all mocked CDP. **This is where the contract lives** |
| **T2 integration** | ✅ | Cap-1.1/1.2, 4.1 against the committed fixture in headless Chromium — **the only tier that can catch a real variant flip before merge** |
| **T3 E2E** | ❌ local only | Cap-6.1 and live confirmation. Cannot gate a merge (CON-3) |

The pyramid is deliberately **T1-heavy**: every capability except live confirmation is provable
with mocks, because the corroboration logic is pure given a scrape result.

### 10.3 Pre-authored oracle (CON-2)

Assertions are authored **before** implementation, in a separate change, and the executor
implementing the fix does not edit them. Per-test dispositions, already adjudicated against the
real fixtures:

| Test | Fixture | Disposition | Capability |
|---|---|---|---|
| `get-post.test.ts:202` "empty comments gracefully" | `commentCount: 5` + `[]` | **INVERT** → expects throw | Cap-3.1 |
| `get-post.test.ts:211` "null evaluate result for comments" | `commentCount: 5` + `null` | **INVERT** → expects throw | Cap-3.1 |
| `get-post.test.ts:227` "missing optional fields" | matched container, `commentCount: 0`, `text: null` | **KEEP GREEN** | **Cap-3.2 + Cap-3.3 — both controls** |
| `get-post-engagers.test.ts:199` "no reactions button found" | `reactionsFound: false` | **HOLD** — OQ-1 | Cap-3.4 (pending) |
| `get-post-engagers.test.ts:222` "empty engagers gracefully" | `totalReactions: 0` + `[]` | **KEEP GREEN** | **Cap-3.2 control** |
| `get-post-engagers.test.ts:237` "null evaluate result" | `totalReactions: 2` + `null` | **INVERT** → expects throw | Cap-3.1 |

**Three inversions, two controls that must survive untouched, one held.** A change that inverts all
six deletes Cap-3.2 and Cap-3.3 — the only tests standing between this design and an
always-throw-on-empty regression. This table is normative for the executor.

New tests are added for every capability with no existing test: Cap-1.3, Cap-1.4, Cap-2.1, Cap-2.2,
Cap-5.1, Cap-5.2.

### 10.4 Test data strategy — the fixture set

PEND-3 (a set rather than a single fixture) was surfaced and is **RATIFIED — four fixtures**:

| Fixture | Proves |
|---|---|
| `legacy/post-with-comments.html` | Cap-1.1, 3.1, 4.1 — the harvested defect page |
| `legacy/post-zero-comments.html` | **Cap-3.2** — the legal-empty control at T2 |
| `legacy/post-image-only.html` | **Cap-3.3** — `text` empty, container present |
| `sdui/post-with-comments.html` | Cap-1.2 — no-regression, harvested from spike logs if a live SDUI session is unavailable |

Three of the four are legacy and harvestable **today**; only the SDUI one may need reconstruction.
Without the middle two, NFR-3 (legal-empty false-positive rate = 0) would have **no T2 evidence at
all** — they are the reason the set was ratified over a single fixture.

### 10.5 Quality gates

| Gate | Threshold |
|---|---|
| T1 + T2 green | blocking |
| `pnpm lint` | blocking |
| Cap-3.2 and Cap-3.3 present and green | **blocking — explicitly named** so they cannot be silently dropped |
| Branch coverage | not below current; contributes toward `#609`'s 80% |
| Copilot review cycle | run to exhaustion (CON-4) |

### 10.6 AI-augmented testing

N/A — no AI/LLM in the system under test.

---

## 11. Quality Requirements

| NFR | Design mechanism |
|---|---|
| NFR-1 detection latency | T2 fixture oracle surfaces a flip in CI (§ 10.2) |
| NFR-2 silent-empty = 0 | Corroboration (§ 4.3) + no terminal fallback (§ 5.2) |
| NFR-3 legal-empty FP = 0 | Container corroborator + Cap-3.2/3.3 as blocking gates |
| NFR-4 extension cost ≤ 1 file | Registry is the only registration point (§ 5.1) |
| NFR-5 diagnosability | Per-adapter detection results in the capture (§ 8.2) |
| NFR-6 branch coverage | § 10.5 |

---

## 12. Feasibility Summary (Phase 4.1)

| Component | Precedent | Dep. maturity | Perf envelope | Team | Verdict |
|---|---|---|---|---|---|
| AdapterRegistry | ✅ `selectors.ts` already registry-shaped | ✅ | ✅ | ✅ | **FEASIBLE** |
| Variant detection | ✅ same CDP `evaluate` already used | ✅ | ✅ | ✅ | **FEASIBLE** |
| Corroboration | ✅ counts already extracted | ✅ | ✅ | ✅ | **FEASIBLE** |
| Typed errors | ✅ ADR-005 hierarchy exists | ✅ | ✅ | ✅ | **FEASIBLE** |
| Diagnostics widening | ✅ capture exists, trigger changes | ✅ | ✅ | ✅ | **FEASIBLE** |
| Fixture harvest + scrub | ⚠️ no precedent — first fixture in repo | ✅ | ✅ | ✅ | **FEASIBLE-WITH-SPIKE** |
| Reactions-modal adapter | ⚠️ unprobed (OQ-1) | ? | ✅ | ✅ | **FEASIBLE-WITH-SPIKE** |

**Two spikes, both time-boxed, neither blocking the critical path:**

- **SPIKE-1 — fixture harvest + scrub** (½ day). Can a legacy post-detail page be captured and
  scrubbed such that the adapters still exercise against it? Success: one scrubbed fixture in
  headless Chromium yielding the known-correct extraction, containing no third-party PII.
- **SPIKE-2 — reactions-modal probe** (2 h). Open the modal on a live legacy post; measure whether
  a container tier exists. Resolves OQ-1, OQ-2, and the held test. **Requires the maintainer's
  live account** — the investigation deliberately stopped short of this as beyond a read.

No Must-Have component is UNCERTAIN or INFEASIBLE. **Feasibility gate: PASS.**

---

## 13. Risk Register (Phase 4.2)

| ID | Risk | L×I | Mitigation |
|---|---|---|---|
| **R-1** | Track B ships without track A → every silent call becomes a hard error in a released product | 2×3 = **6 M** | Sequenced release (§ 15); B ships **second** or with the flip in the notes |
| **R-2** | Inverting "all six" tests deletes Cap-3.2/3.3 → always-throw-on-empty regression | 3×3 = **9 H** | § 10.3 normative table + § 10.5 names both controls as blocking gates |
| **R-3** | Fixture harvested from one post → AC-1a-class false positives return | 2×3 = **6 M** | § 10.4 fixture set (PEND-3) |
| **R-4** | Unscrubbed PII committed to a public AGPL repo | 2×3 = **6 M** | § 8.1 scrub in the harvest tooling, not post-hoc |
| **R-5** | LinkedIn flips back to SDUI mid-migration | 2×1 = 2 L | Both adapters stay tested at T2 regardless of what is live — **this is the design working** |
| **R-6** | `#569` conflicts on `comment-on-post.ts` | 2×2 = 4 M | Tier-3 file: import-site change only (§ 5.3) |
| **R-7** | `#609` raises the threshold while this adds branches | 2×2 = 4 M | Land branch tests with the change (NFR-6) |
| **R-8** | Reactions modal has a different mechanism than assumed | 2×2 = 4 M | § 4.3 — corroboration degrades to cardinal; **architecture does not depend on the answer** |
| **R-9** | Detection is ambiguous — a transitional page matches both adapters | 1×3 = 3 L | `DOMVariantAmbiguousError` + diagnostics; fail loud rather than pick |

**No unmitigated HIGH risks.** R-2 is the only HIGH and carries two independent mitigations.

**Rabbit holes checked (Shape Up 10×):**
- *Redesign Trap* — a uniform rewrite of all ten files. **Avoided** by the three-tier split (§ 5.3);
  five of the ten get an import change only.
- *Integration Fantasy* — assuming the modal shares the post-detail mechanism. **Avoided** by
  SPIKE-2 + R-8.
- *Time-Boxing the Unknown* — both unknowns are spikes, not estimates.

---

## 14. Risks and Open Questions

| ID | Question | Class | Effect |
|---|---|---|---|
| **OQ-1** | Does the reactions modal have a container tier? | **Load-bearing** | Blocks the engagers half of `#823` and the held test → **SPIKE-2** |
| **OQ-2** | Does the container-tier staleness signal hold for the modal? | **Load-bearing** | Same spike |
| **OQ-3** | LinkedHelper 2.130.28 vs 2.130.29 | Non-load-bearing | No requirement depends on it |
| ~~**DQ-1**~~ | AC-13's false binary | **RESOLVED** 2026-08-31 | AC-13 amended; ADR-008 reclaims post-detail citations, ADR-007 untouched (§ 9) |
| ~~**DQ-2**~~ | Fixture set vs single | **RESOLVED** 2026-08-31 | **Four fixtures ratified** (§ 10.4) |
| **DQ-4** | Re-point the 2 out-of-scope ADR-007 citations (`wait-for-reactions-modal.ts`, post-detail unit-test comments)? | Non-load-bearing | Outside the ratified ten; comment-only. Flagged, not absorbed |
| **DQ-3** | Three error classes vs fewer (§ 7.1) | Non-load-bearing | Three recommended — each routes to a different operator action. Collapsible later without redesign; collapsing loses routing signal, not correctness |

**OQ-1 and OQ-2 are the same probe, and they are cleared.** Stage 3 filed it as **#830**. Because
§ 4.3 makes the architecture robust to either answer (corroboration degrades to cardinal if the modal
has no container tier), they ceased to block the moment that item existed — so the brief is
`status: final`. That is the Open-Questions Lock Gate resolving, not being waived: the questions are
still open, but they are *tracked and non-blocking* rather than *open and load-bearing*.

---

## 15. Rollout

| Stage | Content | Gate |
|---|---|---|
| **0** | Pre-authored T1 assertions (§ 10.3), no implementation | Reviewed independently; three inversions RED, two controls GREEN |
| **1** | Registry + detection + adapters; **FR-4 `main` removal** | T1 green including the three inversions |
| **2** | Corroboration + typed errors + diagnostics widening | Cap-3.1–3.4 green |
| **3** | Fixture harvest + scrub + T2 oracle (SPIKE-1) | T2 green in CI with no network |
| **4** | E2E precondition repair; ADR-008 | `pnpm test:e2e` locally |
| **5** | SPIKE-2 → engagers modal adapter | OQ-1 resolved |

**Appetite overrun** → the PRD's pre-declared split point: **track B (stages 0 + 2) ships alone**,
provable at T1 with no LinkedHelper. Stage 1 must then ship *first* or in the same release, or R-1
lands on users.

---

## 16. Requirement-to-Track Coverage Matrix (forward)

| Req | Track(s) | § | ACC | Status |
|---|---|---|---|---|
| FR-1 | Tech Arch, Integration | 4.2, 5.1 | Cap-1.1, 1.2 | covered |
| FR-2 | Tech Arch | 5.1 | Cap-1.4 | covered |
| FR-3 | Tech Arch | 4.1, 5.2 | Cap-2.2 | covered |
| FR-4 | Tech Arch | 5.2 | Cap-1.3, 2.1 | covered |
| FR-5 | Integration | 5.3 | Cap-4.2 | covered |
| FR-6 | Integration | 5.3 | Cap-4.1 | covered |
| FR-7 | Tech Arch | 4.3 | Cap-3.1 | covered |
| FR-8 | API Design | 7.1 | Cap-1.3, 3.1 | covered |
| FR-9 | Tech Arch | 4.3 | Cap-3.2, 3.3 | covered |
| FR-10 | Observability | 8.2 | Cap-5.1, 5.2 | covered |
| FR-11 | Testing Arch, Security | 10.4, 8.1 | Cap-1.1, 3.2, 3.3 | covered |
| FR-12 | Testing Arch | 10.2 | Cap-6.1 | covered |
| FR-13 | ADR | 9 | — (documentation, non-testable) | covered |
| NFR-1..6 | various | 11 | per row | covered |

**19 / 19 covered. Zero UNCOVERED.** FR-13 is classified non-testable (a documentation artifact),
per the § 16 protocol's explicit allowance.

## 16b. Element-to-Requirement Backward-Coverage Matrix

| Element | Type | Traces to | Status |
|---|---|---|---|
| `DOMVariant` | entity | FR-1, FR-2 | traced |
| `Surface` | entity | FR-1 | traced |
| `VariantAdapter` | entity | FR-1, FR-2, FR-3 | traced |
| `AdapterRegistry` | component | FR-2, NFR-4 | traced |
| `ExtractionOutcome` | entity | FR-7, FR-9 | traced |
| Cardinal corroborator | component | FR-7, FR-9 | traced |
| Container corroborator | component | FR-9 (AC-9b), scope item 11 | traced |
| `DOMVariantUnsupportedError` | interface | FR-4, FR-8 | traced |
| `ExtractionFailedError` | interface | FR-7, FR-8 | traced |
| `DOMVariantAmbiguousError` | interface | **net-new** — R-9 | **ratified net-new** (design decision; introduced § 5.2, justified § 13 R-9, specified § 7.1) |
| Per-adapter detection results in capture | component | FR-10, NFR-5 | traced |
| Fixture set (4 files) | test asset | FR-11 + **PEND-3** | traced — **PEND-3 ratified** 2026-08-31 (four fixtures; § 10.4, § 14 DQ-2) |
| Scrub pipeline | component | **net-new** — PEND-2 | **ratified net-new** (privacy constraint, § 8.1) |
| ADR-008 | doc | FR-13 | traced |

**Zero PHANTOM.** Two net-new elements, both surfaced explicitly rather than absorbed.

---

## 17. Glossary

| Canonical | Definition |
|---|---|
| **DOMVariant** | The markup dialect LinkedIn serves for a surface at a moment. Open set |
| **Surface** | A page type: post-detail, feed, search, reactions-modal |
| **VariantAdapter** | Detection + readiness + extraction + container anchors for one `(Surface, DOMVariant)` |
| **Corroborator** | A same-observation signal that makes an empty result trustworthy. Cardinal or container |
| **Corroborated emptiness** | Empty **and** corroborated ⇒ legitimately empty. Empty **and** contradicted ⇒ failed |
| **Chimera record** | A record whose fields came from different dialects — A1's failure mode |
| **Container tier** | The anchor proving the *region* exists, independent of whether it has content |

---

## 18. Design Lock Gate

| Gate | Status |
|---|---|
| Forward coverage (§ 16) | ✅ 19/19, zero UNCOVERED |
| Backward coverage (§ 16b) | ✅ zero PHANTOM, two ratified net-new |
| Feasibility (§ 12) | ✅ PASS — 2 spikes, 0 blocking |
| Risk (§ 13) | ✅ PASS — 1 HIGH, doubly mitigated |
| Open questions (§ 14) | ✅ **cleared** — OQ-1/OQ-2 (one probe) were filed as #830; the architecture is robust to either answer (§ 4.3), so they no longer block |

**DESIGN IS LOCKED.** Brief is `status: final`. All lock conditions are met: DQ-1 and DQ-2 were
resolved (AC-13 amended; four fixtures ratified), and Stage 3 filed the spike as **#830**, which is
what cleared OQ-1/OQ-2 — the Open-Questions Lock Gate resolving, not being waived.

The dual-lens ratification (product lens + UX lens) is **not run**: the session's operating
instructions forbid dispatching agents unless the user requests it, and the UX lens has no subject
here (no user-facing interface). Recorded as not-run rather than claimed.
