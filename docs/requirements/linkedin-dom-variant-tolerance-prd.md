---
type: prd
slug: linkedin-dom-variant-tolerance
date: 2026-08-31
workflow: /capture-requirements
dor_status: passed-with-findings
dor_findings:
  - "3 ratification-pending items (PEND-1..PEND-3, § 12) — PEND-3 carries a real effort delta"
  - "3 open questions (OQ-1..OQ-3, § 10) — OQ-1 blocks the engagers half of #823"
artifacts:
  investigation: .tmp/investigations/alexey-pelykh-lhremote-issue-823.md
  probe: .tmp/investigations/823-q6-live-probe-findings.md
closes: [823, 824, 825]
---

# PRD — LinkedIn DOM Variant Tolerance and Fail-Loud Extraction

| Field | Value |
|---|---|
| Status | Draft — awaiting Stage 2 (`/design-solution`) |
| Owner | alexey-pelykh |
| Repo | `alexey-pelykh/lhremote` |
| Closes | [#823](https://github.com/alexey-pelykh/lhremote/issues/823), [#824](https://github.com/alexey-pelykh/lhremote/issues/824), [#825](https://github.com/alexey-pelykh/lhremote/issues/825) |
| Baseline HEAD | `fad665ded659286cd5fc15763e5625f79e0be862` |
| Evidence | `.tmp/investigations/alexey-pelykh-lhremote-issue-823.md`, `.tmp/investigations/823-q6-live-probe-findings.md` |
| Appetite | 1 week of focused work (see § Appetite) |

---

## 1. Problem Framing

### 1.1 Observation vs interpretation

**Observation** (what is measured): `get-post` and `get-post-engagers` return HTTP-success payloads
whose content fields are empty, on posts that visibly have content. A live run on 2026-08-31
returned `text: ""` and `comments: []` while the *same response* carried `commentCount: 41`. Every
scraper selector matched **0** elements; the readiness gate's anchors matched **85** and **82** on a
fully-loaded 589 KB page.

**Interpretation in the filed issue** (`#823`): *"LinkedHelper 2.130.28 broke it."*
**This interpretation is falsified.** The defect reproduces on **2.130.29**, a version the issue
never names. The discriminating variable is not the LinkedHelper build.

**Grounded cause**: commit `15f5902` (2026-05-07, *Closes #800*) rewrote the post-detail scrapers
for LinkedIn's SDUI markup and left **no legacy path**. LinkedIn is now serving **legacy pre-SDUI
markup again** — `[componentkey]` and `[data-testid]` are absent document-wide, not merely renamed.
The readiness cascade in `packages/core/src/operations/get-post.ts:105-107` therefore falls through
to `document.querySelector('main')`, **which always exists**. Gate green → scrape empty → success
returned.

### 1.2 The problem is not the selectors

Reframing the problem as *"our selectors are stale"* would be the third re-derivation of the same
incident (#776, #800, now #823) and would leave the system in the same posture for the fourth.
The DOM churn is not an incident — it is a **known, documented environmental constant**.
`docs/adr/007-profile-ready-selector-strategy.md` already states it:

> LinkedIn periodically removes or reshapes semantic markers in its DOM. Any selector strategy
> rooted in DOM headings or CSS class names has an expected half-life on the order of
> weeks-to-months.

**The problem this PRD solves** is therefore two structural defects that the variant flip merely
*revealed*:

1. **The readiness gate is not bound to the scraper it gates.** It can be satisfied by a page the
   scraper cannot read. An always-true terminal fallback guarantees this.
2. **The system cannot distinguish "legitimately empty" from "extraction failed."** Both render as
   a success payload with empty fields, so silent data loss is indistinguishable from a true
   negative — to the caller, to CI, and to the operator.

Fixing the selectors treats the symptom. Fixing (1) and (2) means the *next* variant flip is a
caught, diagnosable regression instead of silent data loss.

### 1.3 Prevention over cure

Prevention is available and is why item 7 (fixture harvest) is in scope. No committed DOM fixture
exists anywhere in `packages/`. The legacy variant is **live right now**, which makes harvesting one
cheap today and impossible-to-cheap the moment LinkedIn flips again. A committed fixture converts a
Tier-3 (local-only, LinkedHelper-gated) verification into a Tier-2 CI oracle — the only tier that
can catch this class before merge.

---

## 2. Appetite

**One week of focused work.** Justification: the blocking unknown is already answered (the live
probe closed Q6), so this is bounded corrective work across a known ten-file surface, not a spike.
If the work exceeds the appetite, the split point is pre-declared: **track B ships alone** (§ 6.1),
because it is independently valuable, independently shippable, and provable at Tier 1 without
LinkedHelper.

---

## 3. Object Model (OOUX)

| Object | Definition | Status |
|---|---|---|
| **PostDetail** | The scraped record for one post: author, text, counts, timestamp | exists |
| **Comment** | One comment entity under a post | exists |
| **Engager** | One person who reacted to a post | exists |
| **DOMVariant** | The markup dialect LinkedIn is currently serving for a surface — presently `sdui` or `legacy`; **an open set, not a boolean** | **NEW** |
| **VariantAdapter** | The selector set + extraction logic bound to exactly one `DOMVariant` for one surface | **NEW** |
| **ReadinessAnchor** | A selector whose presence attests the page is ready — must be drawn from the same `VariantAdapter` that will do the extraction | reshaped |
| **ExtractionOutcome** | The trichotomy replacing today's success/failure binary: `complete`, `legitimately-empty`, `failed` | **NEW** |
| **DOMFixture** | A committed, scrubbed HTML snapshot of one `DOMVariant` for one surface, used as a Tier-2 oracle | **NEW** |
| **DiagnosticCapture** | The artifact bundle (URL, title, DOM probes, screenshot) written on a failure | exists — trigger widened |

The two objects that carry the whole design are **DOMVariant** and **ExtractionOutcome**. Today the
codebase models neither: variant is implicit (one hardcoded dialect) and outcome is a binary
(returned or threw). Every requirement below is downstream of making both explicit.

---

## 4. Functional Requirements

Notation: EARS. Each requirement carries a Given/When/Then acceptance criterion and traces to a
ratified scope item (§ 8).

### 4.1 Track A — Variant tolerance (return correct data)

**FR-1 (Ubiquitous)** — The system **shall** extract post, comment, feed and engager data correctly
under **every** `DOMVariant` LinkedIn is observed to serve, currently `sdui` and `legacy`.

> **AC-1**
> **Given** a post-detail page served as `legacy` markup (no `[componentkey]`, no `[data-testid]`)
> **When** `get-post` runs against it
> **Then** `text`, `comments`, `authorName` and `authorProfileUrl` are populated from the legacy
> markup, and `comments.length` is consistent with `commentCount` (§ FR-6).
>
> **AC-1'** — the same, with `sdui` markup, **must not regress**.

*Traces to*: scope items 3, 5. *Applies to*: `get-post.ts`, `get-feed.ts`, `search-posts.ts`,
`comment-on-post.ts`, `react-to-comment.ts`, `dismiss-feed-post.ts`, `hide-feed-author.ts`,
`unfollow-from-feed.ts`, `wait-for-post-load.ts`, `selectors.ts`.

**FR-2 (Ubiquitous)** — Adding support for a **future** `DOMVariant` **shall** require registering a
new `VariantAdapter`, and **shall not** require editing the extraction call sites.

> **AC-2**
> **Given** the shipped variant registry
> **When** a third variant is added
> **Then** the diff touches the registry and the new adapter only — no operation file's control
> flow changes.

*Rationale*: this is premortem item P-1 (§ 7). A two-way hardcoded fallback solves today's flip and
reproduces the incident on the next one. *Traces to*: scope item 5.

**FR-3 (Event-driven)** — When the readiness gate evaluates a page, it **shall** anchor on a
selector belonging to the **same** `VariantAdapter` that will perform the extraction.

> **AC-3**
> **Given** a page whose markup no adapter recognizes
> **When** the readiness gate runs
> **Then** the gate does **not** report ready.

*This is the gate/scraper contract.* Today the gate anchors on `main a[href*="/in/"]` and
`span[dir="ltr"]` — generic anchors present under *both* variants and under neither adapter — which
is precisely why it went green on a page the scrapers could not read.

**FR-4 (Unwanted behavior)** — If no registered `VariantAdapter` matches the page, then the system
**shall** report failure and **shall not** fall back to a selector that is satisfied by any
LinkedIn page.

> **AC-4**
> **Given** `packages/core/src/operations/get-post.ts`
> **When** the readiness cascade is inspected
> **Then** `document.querySelector('main')` is absent from it, and no equivalent
> always-true terminal fallback replaces it.

*Traces to*: scope item 6. **This is the single highest-value line change in the migration** — it is
the mechanism that converted a selector miss into a silent success.

**FR-5 (Event-driven)** — When `get-feed` extracts a post's author, the `authorName` and
`authorProfileUrl` **shall** be read from the **same** author element, so that the two cannot
disagree.

> **AC-5**
> **Given** a feed page under either variant
> **When** `get-feed` returns N posts
> **Then** for every post, `authorProfileUrl` resolves to the person named by `authorName`.

*Traces to*: scope item 3 (#825). The live probe surfaced the same class inside `get-post`:
`authorName` returned duplicated, whitespace-laden text and `authorHeadline` contained the *name*
rather than the headline — evidence that the defect is a shared extraction-anchoring fault, not a
`get-feed`-only bug.

**FR-6 (Event-driven)** — When `get-post` reports `commentCount`, it **shall** parse a single
comment-count value, and **shall not** concatenate digits from adjacent counters.

> **AC-6**
> **Given** a post whose social-counts element reads `"2 41 comments"` (2 reactions, 41 comments)
> **When** `get-post` runs
> **Then** `commentCount` is `41` and `reactionCount` is `2`.

*Traces to*: scope item 2 (#824). The `"2 41 comments"` string is verbatim from the live probe and
is a usable Tier-1 fixture as-is.

### 4.2 Track B — Fail loudly (never silently empty)

**FR-7 (Unwanted behavior)** — If an extraction returns empty **while a same-response signal
attests content exists**, then the system **shall** throw a typed error and **shall not** return a
success payload.

> **AC-7** (the self-contradiction discriminator)
> **Given** `commentCount > 0` and `maxComments > 0`
> **When** the comment scrape yields `[]` or `null`
> **Then** the operation throws.
>
> Verified live: `41 > 0 && [] && 10 > 0` fired on real data.

*Traces to*: scope item 4.

**FR-8 (Ubiquitous)** — The error thrown by FR-7 **shall** be a typed error in the ADR-005
hierarchy, not a plain `Error`.

> **AC-8**
> **Given** the post-detail path
> **When** any of its failure branches throws
> **Then** the thrown value is an instance of a class extending `ServiceError` or `CDPError`, and
> `packages/core/src/operations/` contains no `throw new Error(` on the post-detail path.

*Current conformance gap, confirmed*: `get-post.ts` throws
`new Error("Failed to extract post detail from the DOM")` and `wait-for-post-load.ts` throws
`new Error("Timed out waiting for post detail to appear in the DOM")` — both plain. The existing
hierarchy already offers the right shape (`ExtractionTimeoutError`, `ActionExecutionError`,
`CDPEvaluationError`); this PRD does not decide which — that is Stage 2. *Traces to*: scope item 4.

**FR-9 (Ubiquitous)** — A **genuinely empty** result **shall** continue to return normally.

> **AC-9a** (GREEN CONTROL — mandatory)
> **Given** `commentCount: 0` / `totalReactions: 0`
> **When** the scrape yields `[]`
> **Then** the operation returns normally with an empty array and does **not** throw.
>
> **AC-9b** (GREEN CONTROL — mandatory)
> **Given** a matched container whose text field is `null`
> **When** extraction runs
> **Then** `text` is `""` and the operation does **not** throw.

**AC-9a and AC-9b are the most important acceptance criteria in this PRD.** Without both, FR-7
degenerates into always-throw-on-empty and destroys a legal outcome: image-only posts, link-only
posts, and posts with zero comments are all normal and must keep working.

**FR-10 (State-driven)** — While `LHREMOTE_CAPTURE_DIAGNOSTICS=1`, when an operation fails under
FR-7, the system **shall** write a `DiagnosticCapture` — the same artifact bundle the timeout path
already writes.

> **AC-10**
> **Given** `LHREMOTE_CAPTURE_DIAGNOSTICS=1` and a page reproducing the FR-7 condition
> **When** the operation fails
> **Then** a `lhremote-diagnostics-XXXXXX/` directory exists containing URL, `document.title`, DOM
> probes and a full-page screenshot, and its path is reported on stderr.

*Rationale*: project directive 8 mandates inspecting these artifacts before changing post-detail
selectors — but capture is **timeout-gated**, and this defect never times out. The directive is
therefore currently **undischargeable for exactly the defect class it exists to serve**.
*Traces to*: scope item 8.

### 4.3 Verification infrastructure

**FR-11 (Ubiquitous)** — The repository **shall** carry a committed `DOMFixture` for the `legacy`
post-detail variant, and the Tier-2 suite **shall** assert extraction against it.

> **AC-11**
> **Given** the committed legacy fixture
> **When** the Tier-2 suite runs in CI, with no LinkedHelper and no network
> **Then** extraction yields the fixture's known-correct post text, comment count and author fields.

*Traces to*: scope item 7. **Time-sensitive**: harvestable only while the legacy variant is live.

**FR-12 (Unwanted behavior)** — If an E2E test's assertions are reachable only when a collection is
non-empty, then that test **shall** assert the precondition explicitly instead of conditionally
skipping.

> **AC-12**
> **Given** `packages/e2e/src/get-post-engagers.e2e.test.ts:116` and
> `packages/e2e/src/get-post.e2e.test.ts:205`
> **When** each is run against a post whose engagers/comments are empty
> **Then** the test **fails** rather than passing vacuously.

*Both sites are literally `if (parsed.X.length > 0) { …assert… }`.* These are the two tests best
positioned to have caught #823, and their conditional guards are why they did not. Project
directive 6 forbids exactly this shape. *Traces to*: scope item 9.

**FR-13 (Ubiquitous)** — The repository **shall** carry an ADR recording the post-detail readiness
strategy and the `ExtractionOutcome` (empty-vs-error) contract.

> **AC-13**
> **Given** `docs/adr/`
> **When** the migration is complete
> **Then** a new Accepted ADR-008 exists that (a) states the surface-agnostic
> gate-binds-to-extractor invariant, (b) defines the empty-vs-error contract normatively, and
> (c) reclaims the post-detail citations that had borrowed ADR-007 beyond its own stated scope.
>
> **Amended 2026-08-31 (user-ratified).** The original binary — *extend ADR-007 to post-detail, or
> supersede it* — was a false dichotomy, and grounding it against the artifact showed why:
> ADR-007 is `Accepted`, decides an `aria-label` disjunction for **profile/company readiness**, and
> carries **14 live citation sites** across source, tests, `CLAUDE.md` and `vitest.e2e.config.ts`.
> It is neither outdated nor superseded. What was wrong was never ADR-007 — it was `wait-for-post-load.ts`
> **borrowing** it for post-detail, a surface ADR-007 never claimed. ADR-008 therefore takes the
> post-detail citations and leaves ADR-007 intact and in force for the surface it actually decided.
> The user's standing policy — *no outdated or superseded ADRs kept in the tree* — is adopted and
> recorded; it simply does not fire here, because nothing is being superseded.

*Rationale*: post-detail readiness currently **borrows** ADR-007, which is empirically scoped to
profile and `/company/` pages. Extending it is a deliberate decision, not an inheritance.
*Traces to*: scope item 10.

---

## 5. Non-Functional Requirements (Planguage)

| ID | Requirement | Scale | Must | Plan | Trace |
|---|---|---|---|---|---|
| **NFR-1** | Variant-miss detection latency — time from a variant flip to a red signal | Where the failure first surfaces | Not in user data | CI (Tier 2) | FR-11 |
| **NFR-2** | Silent-empty rate — successful responses carrying self-contradictory empty content | Occurrences per release | **0** | 0 | FR-7 |
| **NFR-3** | Legal-empty false-positive rate — legitimately empty results wrongly throwing | Occurrences per release | **0** | 0 | FR-9 |
| **NFR-4** | Variant-extension cost — files touched to add a third variant | Files changed outside the adapter | ≤ 1 (the registry) | 1 | FR-2 |
| **NFR-5** | Diagnosability — operator can determine *why* an extraction failed without re-running | Artifacts on disk after a failure | Capture present | Capture present | FR-10 |
| **NFR-6** | Branch coverage — this migration's own new branches | vitest branch % on changed files | Not below repo threshold | Contributes toward #609's 80% | § 9 |

NFR-2 and NFR-3 are a **paired constraint**: optimizing either alone degrades the other. Any design
satisfying only one is rejected.

---

## 6. Constraints

### 6.1 CON-1 — Behavior flip (must be communicated, not mitigated away)

Shipping track B **without** track A converts every currently-silent call into a hard error:
CLI exits `1`, MCP returns `isError: true`. **This is the requested behavior and it is more honest**
— but it is a live behavior change, not a no-op, and it lands in a released product (`0.20.1`).

The release carrying track B **shall** state this in its notes. If the tracks ship separately, track
B ships **second** or ships with the flip called out.

### 6.2 CON-2 — Oracle independence (executor-uneditable)

Work class is **`deterministic-output`**. The Tier-1 assertions encoding the new contract **shall be
authored before, and independently of, the implementation** — not written by the executor that also
writes the fix. An executor that authors both the code and the assertions grading it has no
independent gate.

**Per-test adjudication (corrects an inherited claim).** The seed material characterized *"six
currently-GREEN unit tests assert the behavior the issues call a defect."* Reading each fixture
against the FR-7 discriminator, that is **not accurate**, and the difference is load-bearing:

| # | Test | Fixture | Disposition |
|---|---|---|---|
| 1 | `get-post.test.ts:202` `handles empty comments gracefully` | `commentCount: 5` + `comments: []` | **INVERT** — self-contradictory |
| 2 | `get-post.test.ts:211` `handles null evaluate result for comments` | `commentCount: 5` + `comments: null` | **INVERT** — self-contradictory |
| 3 | `get-post.test.ts:227` `handles missing optional fields in post detail` | matched container, `commentCount: 0`, `text: null` | **KEEP GREEN** — this *is* AC-9a **and** AC-9b |
| 4 | `get-post-engagers.test.ts:199` `returns empty engagers when no reactions button found` | `reactionsFound: false` | **OPEN** — see OQ-1 |
| 5 | `get-post-engagers.test.ts:222` `handles empty engagers gracefully` | `totalReactions: 0` + `[]` | **KEEP GREEN** — this *is* AC-9a |
| 6 | `get-post-engagers.test.ts:237` `handles null evaluate result for engagers` | `totalReactions: 2` + `null` | **INVERT** — self-contradictory |

So: **3 inversions, 2 already-present GREEN controls that must survive, 1 undecided.** Tests 3 and 5
are not defects to fix — they are the controls CON-2 mandates, and they already exist. An executor
told "invert the six" would delete the very safeguards that keep FR-9 honest.

### 6.3 CON-3 — Tier boundaries (ADR-004)

T1 unit and T2 integration run in CI; **T3 E2E is local-only and never runs in CI**. Therefore no
E2E assertion can gate a merge. Any requirement whose only oracle is E2E is, for merge purposes,
**unverified** — which is why FR-11 (a Tier-2 fixture oracle) is in scope rather than optional.

### 6.4 CON-4 — Project directives

Bound by `CLAUDE.md`: branch-per-change (`enforce_admins` on, never push to `main`); commit format
`(type) scope: description` with **no** issue numbers; `Closes #N` in the PR body; `pnpm lint`
before push; the Copilot review cycle run to exhaustion; shared E2E helpers from
`@lhremote/core/testing` rather than local duplicates.

---

## 7. Assumptions and Risks

Premortem — *assume this shipped and failed; why?*

| ID | Failure mode | Mitigation |
|---|---|---|
| **P-1** | Variant tolerance built as a hardcoded SDUI→legacy fallback; a **third** variant appears and the chain again ends in silence | FR-2 + FR-4 (open registry, no always-true terminal) |
| **P-2** | FR-7 over-fires: legal empty posts start erroring in production | FR-9 AC-9a/AC-9b as **mandatory** controls; NFR-2/NFR-3 as a paired constraint |
| **P-3** | The fixture is harvested from **one** post (text-only, 41 comments) and does not represent image-only, link-only, video, or zero-comment posts — so AC-1a-class false positives return | Harvest a **set**; at minimum add one zero-comment and one image-only page |
| **P-4** | The executor writing the fix also rewrites the assertions grading it | CON-2 |
| **P-5** | The harvested fixture is a real LinkedIn page containing **real personal data** committed to a public AGPL repo | The fixture **must be scrubbed** before commit — names, profile URLs, avatars, comment text of third parties. This is a hard gate on FR-11, not a nicety |
| **P-6** | `comment-on-post.ts` is edited concurrently by #569 | § 9 sequencing |
| **P-7** | #609 raises the branch threshold to 80% while this migration adds branches | NFR-6; land this migration's branch tests with it |
| **P-8** | LinkedIn flips **back** to SDUI mid-migration, and the legacy path is verified only against a snapshot | Acceptable — that is exactly what FR-11 exists for; both adapters stay tested at Tier 2 regardless of what is live |
| **P-9** | `get-post-engagers`' modal path differs from the post-detail path, and the fix assumes they share a cause | OQ-1 — resolve before closing #823's engagers half |

| ID | Assumption | If false |
|---|---|---|
| **ASM-1** | The `legacy` markup being served is stable enough to harvest against | Fixture still valid as a regression oracle; only its "currently live" claim lapses |
| **ASM-2** | The two variants are the complete observed set | FR-2 already assumes they are not — no change required |
| **ASM-3** | `get-post-engagers` shares the post-detail root cause | OQ-1 |

---

## 8. Traceability — ratified scope → requirements

The scope is an **explicit bounded selection**, user-ratified. Items not listed were not selected;
downstream stages must not add to it by interpretation.

| # | Ratified scope item | Requirements |
|---|---|---|
| 1 | #823 silent empty | FR-4, FR-7, FR-8, FR-9 |
| 2 | #824 `commentCount` concatenation | FR-6 |
| 3 | #825 `get-feed` author disagreement | FR-1, FR-5 |
| 4 | Track B fail-loudly typed error | FR-7, FR-8 |
| 5 | Track A variant tolerance, 10 files | FR-1, FR-2, FR-3 |
| 6 | Remove the always-true `main` fallback | FR-4 |
| 7 | Harvest a legacy DOM fixture | FR-11 |
| 8 | Capture-on-empty diagnostics | FR-10 |
| 9 | Repair 2 E2E precondition violations | FR-12 |
| 10 | ADR for readiness + empty-vs-error | FR-13 |
| 11 | Amend AC-1a to container-tier signal | FR-3, FR-9 (AC-9b), § 10 |

**Coverage**: 11 / 11 ratified items carry at least one requirement. No requirement below traces
outside the ratified set.

---

## 9. Sequencing and Collisions

- **#569** (`CDP-direct actions must check and debit LH action budget`) edits
  `comment-on-post.ts:93-106`, which is on this migration's ten-file list. Different concern, same
  file. **Sequence or coordinate** — advisory, not dispositioned here.
- **#609** (`raise branch coverage threshold from 69% to 80%`) interacts in both directions: variant
  tolerance adds branches and CON-2's inversions change assertions. Its own blockers (#599, #600)
  are already closed. **Land this migration's branch tests with it** (NFR-6).

---

## 10. Open Questions

Recorded, not decided. Each names what would settle it.

**OQ-1 — Is `get-post-engagers`' reactions-modal path affected by the same cause?**
Its post-detail selectors already measured **0** and it shares the readiness cascade, but the modal
itself was never opened: doing so drives UI interaction beyond a read, and the probe was
deliberately kept read-only against a live licensed account.
*Settled by*: opening the reactions modal on a live legacy-variant post and measuring its selectors.
*Blocks*: the disposition of CON-2 test #4, and the engagers half of #823.

**OQ-2 — Does AC-1a's container-tier staleness signal hold for the reactions modal?**
Scope item 11 amends AC-1a from *"empty result ⇒ stale"* to a **container-tier** signal (*container
matched but contents empty ⇒ legal; container did not match ⇒ stale*), because the unamended form
false-positives on every legal image-only or link-only post. Whether the modal has an equivalent
container tier is unknown — it depends on OQ-1.

**OQ-3 — LinkedHelper version discrepancy.**
Issue #823 names **2.130.28**; the investigation recorded that version as independently confirmed on
this machine; the CDP target path shows **2.130.29**. Unresolved whether LinkedHelper auto-updated
between the investigation and the probe, or the earlier confirmation was mistaken.
*Impact on this PRD*: **none** — the defect reproduces on 2.130.29, which strengthens rather than
weakens the finding, and no requirement here depends on a LinkedHelper version. Recorded so it is
not silently re-derived.

---

## 11. Out of Scope

- Rewriting the operations layer or the CDP transport (ADR-002, ADR-006 stand).
- Any operation not on the ten-file list.
- #569's action-budget debit, and #609's threshold raise — both **interact** (§ 9) but neither is
  in this scope.
- Detecting the variant flip proactively (monitoring / alerting on LinkedIn markup changes).
  Defensible follow-up; **not selected**.
- Changing the MCP or CLI surface shape beyond the error-vs-success flip CON-1 already describes.

---

## 12. Provenance (Definition-of-Ready gate)

The ratified scope (§ 8) was user-selected and is binding. Requirements derived from it are
authorized by that selection. **Three items in this PRD are not** — they were derived here, from the
premortem, and are recorded as **ratification-pending** rather than presented as ratified:

| ID | Item | Origin | Nature | If rejected |
|---|---|---|---|---|
| **PEND-1** | **NFR-4** — adding a third variant must cost ≤ 1 file outside the adapter | premortem P-1 | *Tightens* item 5. "Variant tolerance" was ratified; this fixes a **bar** for it that the user never set | Drop the numeric bar; FR-2's intent survives as a design preference |
| **PEND-2** | **P-5** — the harvested fixture must be scrubbed of third-party personal data before commit | premortem | *Constrains* item 7. Publishing a real LinkedIn page into a **public AGPL repo** commits real names, profile URLs and comment text of third parties | Not recommended — this is a privacy/legal constraint, not a preference |
| ~~**PEND-3**~~ | **RATIFIED 2026-08-31** — harvest a fixture **set of four** (defect page, zero-comment, image-only, SDUI control) | premortem → user | Was an expansion of item 7; **now ratified and binding** | n/a — ratified |

**PEND-3 was surfaced and is RATIFIED** (four fixtures). PEND-2 is a constraint no reasonable
scoping would decline and was adopted as a design constraint at Stage 2 § 8.1. PEND-1 remains a
design bar, met by the Stage 2 registry design.

**DQ-1 (AC-13's false binary) was surfaced and is RESOLVED** — see the amendment on AC-13 above.

Nothing else in this document originates outside the ratified selection.
