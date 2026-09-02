# ADR-008: Post-Detail Readiness Binding and the Empty-vs-Error Contract

## Status

Accepted (2026-09-01)

This ADR governs the **post-detail** surface: the readiness gate in
`packages/core/src/cdp/wait-for-post-load.ts` and the extraction it gates in
`packages/core/src/operations/get-post.ts`. It also states the empty-vs-error
contract for every extraction surface, including
`packages/core/src/operations/get-post-engagers.ts`. It was subsequently bound to the
**search-results** surface (`packages/core/src/operations/search-posts.ts`) — see § Amendments.

**Relationship to ADR-007** — ADR-008 **reclaims** the post-detail citations that had
borrowed ADR-007. ADR-007 remains `Accepted`, is **not modified by this reclamation**, and stays
in force for member profile (`/in/{publicId}/`) and organization (`/company/{slug}/`) pages — and
for the diagnostic-capture pattern on every surface it names, which ADR-008 does not touch. See
§ Decision → *Disposition of ADR-007*, which states this explicitly rather than leaving it
implied.

## Context

### What broke

Commit `15f5902` (*Closes #800*) rewrote the post-detail scrapers for LinkedIn's
React/SDUI markup and left no path for the pre-SDUI dialect. By 2026-08-31 LinkedIn was
serving the **legacy pre-SDUI markup again on the same URLs**, so `[componentkey]` and
`[data-testid]` matched zero elements document-wide. Two independent always-true
fallbacks, in two different files, combined to turn that into a silent success:

1. **The readiness gate** anchored on the union
   `main a[href*="/in/"], main a[href*="/company/"]`. That anchor is *variant-agnostic* — it
   matches under any dialect — so the gate went green on a page the scrapers could not read.
   (The probe below counted the `/in/` branch alone; the `/company/` branch was not counted
   separately, and one branch matching is enough to satisfy a CSS union.)
2. **The extractor's scope cascade** ran SDUI-`componentkey` → `data-sdui-screen` →
   `document.querySelector('main')` → `document`. The last two always match, so
   extraction ran against a structurally valid scope whose SDUI-only *field* selectors
   matched nothing.

Gate green, scrape empty, HTTP success. Measured live on 2026-08-31 against a
fully-loaded 589 KB post-detail page (LinkedHelper 2.130.29):

| Probe | Elements matched |
|---|---|
| every scraper field selector | **0** |
| `main a[href*="/in/"]` — the member-profile branch of the gate's union | **85** |
| `span[dir="ltr"]` | **82** |
| legacy `.update-components-text` | **41** |
| legacy `[data-id^="urn:li:"]` | **40** |
| `get-post` returned | `text: ""`, `comments: []`, **`commentCount: 41`** |

The last row is the whole defect in one line: the response carried a count of 41 comments
next to an empty comment list, and reported success.

**What this table does and does not license.** It measures the *page*, and it is what justifies
registering a legacy adapter at all. It is **not** a measurement of the anchors that shipped. The
legacy adapter's `detect` is `[data-id^="urn:li:activity:"]` — a deliberate **narrowing** of the
measured `[data-id^="urn:li:"]`, because the measured selector also matches `urn:li:comment:`
entities and a comment is not an extraction root. That narrowing is a hypothesis with two
unmeasured halves, and **neither has a recorded count**: that at least one of the 40 hits is an
`activity:` container (if they are all comments, the adapter claims nothing and a legacy page is
reported unsupported), and that `data-id` never appears on an SDUI page (if it does, both adapters
claim healthy pages and extraction reports ambiguity). The second is better grounded — the SDUI
rewrite replaced `data-id` with `componentkey` — but it is still an inference.

**No adapter registered under this ADR is fixture-verified.** No committed DOM fixture exists yet:
#828 harvests them and #838 asserts extraction against them. The decisions below are therefore
sound as *decisions* while their per-dialect selector bindings remain the current best hypothesis
rather than a measured fact. This is recorded here so a future selector regression is diagnosed
against what was actually known, not against what this table appears to promise.

### Why this is two defects, not one

- **(a) The gate was not bound to the scraper it gates.** An anchor chosen for surviving
  markup change cannot detect a markup change. This is a *binding* defect, and no
  improvement to the anchor's selector fixes it.
- **(b) The system could not distinguish *legitimately empty* from *extraction failed*.**
  A post with no comments and a post whose comment selectors died returned the same
  value. This is a *contract* defect.

Both had to be fixed, and fixing either alone leaves the silent success in place: (a)
without (b) still returns an empty record whenever a field's selectors rot without the
whole dialect flipping; (b) without (a) never runs, because the gate admits a page no
adapter can read.

### The drift is non-monotonic

LinkedIn served React/CSS-Modules/SDUI for post detail from 2026-05-06 and legacy again
by 2026-08-31 — forward, then backward, on the same URLs, plausibly as a per-session A/B
bucket. This is a stronger statement than "LinkedIn's markup changes": it means the
dialect cannot be a build constant, a config flag, an environment variable, or a dated
migration. It has to be **detected on the page being read**.

ADR-007 already supplies the governing principle, and it is quoted here rather than
re-derived:

> LinkedIn periodically removes or reshapes semantic markers in its DOM. Any selector
> strategy rooted in DOM headings or CSS class names has an expected half-life on the
> order of weeks-to-months.
>
> — ADR-007 § Context

A design that assumes exactly two dialects forever contradicts that principle.

## Decision

### 1. The binding invariant

> **A readiness gate MUST anchor on a selector belonging to the same adapter that will
> perform the extraction. An anchor chosen for surviving markup change cannot gate
> variant-specific extraction.**

This is stated as a surface-agnostic invariant, not as a post-detail selector. It has
three normative consequences:

- A readiness anchor **MUST NOT** be shared across dialects. Sharing is what makes the
  gate blind to the change it exists to catch.
- The readiness predicate **MUST** be satisfied only when exactly one adapter claims the
  page **AND that adapter's own readiness anchor is present**. Claiming without readiness
  is not ready; readiness without an unambiguous claim is not decidable.
- A "liveness" anchor — one answering *did the page render at all?* — remains legitimate
  as a **diagnostic**, and **MUST NOT** be used as the gate.

The distinction is not a property of the selector string. `a[href*="/in/"]` scoped to
`<main>` is variant-agnostic; the *same* selector scoped to an SDUI root or to a legacy
`[data-id^="urn:li:activity:"]` container is variant-specific. What landed rebinds the
scope rather than replacing the selector — the old gate's author-link stage survives, now
evaluated inside the selected adapter's own roots
(`packages/core/src/linkedin/dom-variant.ts`, `authorLinkWithin`).

The readiness anchor is also deliberately **stricter than the adapter's detect anchor**: a
container can be present in a skeleton state before the post body hydrates, so gating on
the container alone would let extraction run against an empty container and hand back an
empty record — the failure being removed, not a new one.

**One accepted residual, recorded rather than glossed.** The SDUI adapter's `detect` and `scopes`
span two roots — the post-detail container and the wider SDUI *screen* — and the screen-scoped
half of `ready` is genuinely weaker than the container-scoped half: the screen contains the
comment list, so a commenter's link can satisfy readiness before the post body hydrates. That is
accepted deliberately, and it is bounded: it applies only on the fallback path, where the
alternative is no adapter at all, and the extractor excludes `replaceableComment_` subtrees so a
commenter still cannot be picked as the author. A reader of this ADR alone should not over-trust
the gate on that path — the invariant holds, but the margin on the fallback root is thinner than
on the primary one.

The former gate anchors are retained as **diagnostics only**, and they earn their place:
paired with a document-wide author-link probe they separate *"the page failed to render
entirely"* from *"the page rendered navigation and sidebar chips but not the post body"*.

### 2. `DOMVariant` is an open set

> **`DOMVariant` is an OPEN SET. The registered dialects are informational, never the
> type's domain.**

As implemented (`packages/core/src/linkedin/dom-variant.ts`):

```ts
export type DOMVariant = (typeof KNOWN_DOM_VARIANTS)[number] | (string & {});
export const KNOWN_DOM_VARIANTS = ["sdui", "legacy"] as const;
```

A closed union (`"sdui" | "legacy"`, or a boolean `isSdui`) would force a *type* change —
and therefore a call-site change — to admit the third dialect. Given ADR-007's
weeks-to-months half-life, the third dialect is unknown and unschedulable, so the design
must not require scheduling it.

Normatively:

- Registering a dialect **MUST** be additive: append one `VariantAdapter` to the surface's
  array. Nothing at a call site branches on the variant — detection, readiness and
  extraction are all *generated* from that array — so no control flow changes.
- A new dialect **MUST NOT** be required to appear in `KNOWN_DOM_VARIANTS` before it can
  be registered. That list is for discoverability.
- Each adapter is keyed on the **pair** `(Surface, DOMVariant)`, because the same dialect
  renders different surfaces differently.

An adapter binds four anchors, and their non-interchangeability is the point:

| Anchor | Answers | Constraint |
|---|---|---|
| `detect` | *is this dialect present?* | MUST be decisive and exclusive — matching on a sibling's dialect makes selection report ambiguity on a page that is not hybrid |
| `ready` | *has this dialect finished rendering?* | MUST belong to this adapter (§ 1) |
| `scopes` | *where does extraction root?* | ordered by decreasing precision **within one dialect**; MUST NOT contain an always-true terminal member |
| `extract` | *how are this dialect's fields read?* | source, not a selector bag — the dialects differ in extraction *algorithm*, not just in strings |

### 3. Selection has exactly three outcomes and none is a default

> **There is no terminal fallback. `<main>` and `document` are not adapters.**

| Adapters whose `detect` matches | Outcome |
|---|---|
| exactly one | that adapter is selected |
| zero | `DOMVariantUnsupportedError` — LinkedIn changed; register an adapter |
| two or more | `DOMVariantAmbiguousError` — transitional or hybrid page; refuse to guess |

An adapter that matches but **cannot resolve its own `scopes`** has not read the page, and
is treated as "no usable adapter" — the same `DOMVariantUnsupportedError`. It does not
widen to `<main>`.

Ambiguity fails loud rather than picking a winner because a record assembled from two
dialects is wrong in a way nothing downstream can detect. This is the same reason a
widened selector union is rejected: a union cannot report *which* dialect it matched.

**Zero-match does not raise immediately at the gate.** A page that has not hydrated yet
also matches zero adapters, so failing fast on the first probe would be indistinguishable
from "LinkedIn changed" and would fire on every slow load. The gate therefore polls first
and classifies **once, at the deadline**, when "not yet" has been ruled out — which is
also the only point at which the distinction is decidable:

| Adapters matching at the deadline | Error |
|---|---|
| zero | `DOMVariantUnsupportedError` |
| two or more | `DOMVariantAmbiguousError` |
| exactly one | `ExtractionTimeoutError` — the dialect is known, it never finished rendering |

If the classification probe itself throws or returns a malformed result, that is **not
evidence about the page** — only that the instrument did not run usefully — so the
ordinary timeout is raised rather than blaming LinkedIn for a broken probe.

### 4. The empty-vs-error contract

> **An empty extraction is trustworthy only when a signal from the SAME observation
> corroborates it.**

Every extraction resolves to exactly one of three outcomes:

| Outcome | Meaning | Behavior |
|---|---|---|
| **complete** | an adapter read the page and produced records | return normally |
| **legitimately empty** | an adapter read the page and there was genuinely nothing to find | return normally |
| **failed** | the page was not read, or a field's emptiness is contradicted from within the same observation | **raise** |

"Same observation" is load-bearing. The corroborator must come off the very page that was
just scraped, so that a disagreement is a **self-contradiction** rather than two readings
of two different things.

Two corroborator tiers, deliberately not collapsed into one:

| Tier | Corroborator | Empty is legal when | Empty is a failure when |
|---|---|---|---|
| **Cardinal** | a count rendered on the same page (`commentCount`, `totalReactions`) | count is `0` | count is `> 0` |
| **Container** | did the adapter resolve its own scope anchor? | the scope resolved (the post genuinely has no text) | the scope did not resolve |

**Why the container tier exists.** The obvious single rule — *empty result implies stale
selectors* — was tried and is wrong: it false-positives on **every legitimate image-only
and link-only post**, which has no body text and a perfectly good container. The container
tier is what keeps `text: ""` a legal answer. Collapsing the two tiers reintroduces that
false positive; that is the reason they are separate, and it is recorded here so a future
simplification does not undo it.

Normatively:

- A caller **MUST NOT** be handed an empty record it cannot distinguish from a real empty
  one.
- The cardinal tier **MUST** treat any non-positive or non-numeric count as *no
  contradiction* — zero (the legal empty this check exists to preserve), a negative, and
  `NaN`. A `NaN` count is a parsing regression elsewhere and must not surface as a
  stale-selector diagnosis pointing at this field.
- Emptiness that is the **caller's own instruction** is not an observation and **MUST NOT**
  be corroborated. `get-post` skips the check when the caller asked for zero comments.
- The cardinal check **MUST** be measured on the whole scrape, not on a pagination window:
  a `start` offset past the end of a successful scrape legitimately yields no rows.
- A surface with **no entry in the adapter registry** has no container tier and degrades to the
  cardinal tier alone. The reactions modal is such a surface today — `Surface` admits only
  `"post-detail"`, so `"reactions-modal"` reaches the corroborator as a bare string naming the
  scraper rather than a dialect. Whether it has a container tier at all is unprobed (#830), and
  the contract holds either way.

On post-detail the container tier is enforced **structurally, upstream of any per-field
check** — an adapter that cannot resolve its own scope yields no record and raises
`DOMVariantUnsupportedError` (§ 3), so no separate container-corroboration call exists.
The cardinal tier is a per-field check and is where the shared helper lives
(`packages/core/src/linkedin/corroboration.ts`).

### 5. Error taxonomy

> **Three distinct new `ServiceError` subclasses, because they demand three different
> operator responses.**

| Class | Fires when | Operator action |
|---|---|---|
| `DOMVariantUnsupportedError` | no registered adapter matched the page, or the matching adapter could not resolve its scope | **LinkedIn changed.** Register an adapter for the new dialect |
| `ExtractionFailedError` | an adapter matched, but a field's emptiness is contradicted by its corroborator | **This adapter is partially stale.** Repair that field's selectors |
| `DOMVariantAmbiguousError` | two or more adapters claimed the same page | **Transitional or hybrid page.** Inspect the diagnostics and tighten the `detect` anchors |

Collapsing these into one class discards the most useful information the system now has —
the three are not severities of one condition, they are three different repairs.

**Why ADR-005's existing classes were insufficient.** ADR-005 established the four-tier
hierarchy and the principle that *errors carry domain context*; these three extend it
rather than departing from it. The existing classes were considered and rejected:

- `ExtractionTimeoutError` — **wrong by construction**. Nothing timed out; the entire
  defect class is a gate going green *promptly* on a page the scrapers cannot read. Reusing
  it would name the one symptom that was absent.
- `CDPEvaluationError` — describes the `Runtime.evaluate` **call** failing. Here the call
  succeeds and its **result** is wrong. That is a different layer of the ADR-005 stack.
- `ActionExecutionError` — too generic to route on: it cannot tell an operator whether to
  register an adapter or repair a selector.

Per ADR-005's context-carrying rule, each new class carries what its repair needs:
`DOMVariantUnsupportedError` carries `surface` and `triedVariants`;
`ExtractionFailedError` carries `surface`, `variant`, `field` and `corroborator`;
`DOMVariantAmbiguousError` carries `surface` and `matchedVariants`.

The user-facing message **MUST name the variant and the field**. An agent consuming the
MCP tool is the least able party to diagnose this, and a message it cannot act on is a
silent failure with extra steps.

`ExtractionTimeoutError` gains a `subject` discriminator (defaulting to `"Profile"` for the
original database-extraction call shape; the post-detail gate passes `"Post-detail"` and a
`target` naming the anchor's **role** — `"readiness anchor of the selected post-detail adapter"` —
rather than the selector string). This replaces a bare `Error` in `wait-for-post-load.ts` and
closes a confirmed ADR-005 conformance gap. The per-adapter detect counts are deliberately **not**
folded into this error; their home is the diagnostic capture, which #835 has since extended to
fire on extraction failure and to carry a `variantDetection` bundle field — see ADR-007
§ 2026-09-01 Amendment, which owns that pattern.

### Disposition of ADR-007

The disposition is stated explicitly, because leaving it implied is how the original defect
happened — post-detail *borrowed* ADR-007 without any record that it had.

> **ADR-008 RECLAIMS the post-detail citations of ADR-007. ADR-007 itself stays `Accepted`, is
> untouched by this reclamation, and remains in force for member profile and `/company/` pages.**

("Untouched by this reclamation" is the precise claim, and it is narrower than "never amended":
ADR-007 goes on accruing amendments in its own right — it gained one on 2026-09-01 for the
diagnostic-capture pattern. What ADR-008 asserts is that *this* decision changes nothing in it.)

It is neither an extension nor a supersession, and both of those framings were considered
and rejected:

| Candidate disposition | Rejected because |
|---|---|
| **Extend ADR-007 to post-detail** | It would propagate the defect into the record. ADR-007's strategy is *deliberately* variant-agnostic; extending it would ratify a variant-agnostic gate for a surface that needs a variant-specific one |
| **Supersede ADR-007 for post-detail** | Nothing about ADR-007 is wrong or outdated. It is `Accepted`, decides an `aria-label` disjunction for **profile and company readiness only**, and its live citation sites include `unfollow-profile.e2e.test.ts`, which asserts its amended premise by name. Superseding a correct, load-bearing, actively-cited decision to fix a *different* surface would delete a record that is still true |

**ADR-007 was never the defect.** Its variant-agnostic strategy is **correct for profile
navigation**, where readiness means only *"the page hydrated"* before a follow-state query
runs, and **exactly wrong for post-detail**, where the gate must guard variant-specific
extraction. The defect was `wait-for-post-load.ts` **borrowing** ADR-007 for a surface
ADR-007 never claimed, thereby inheriting a property that is right there and catastrophic
here.

What generalizes from ADR-007 is not its selectors but the **invariant they are an instance
of** (§ 1). ADR-008 cites ADR-007 as the precedent instance on a different surface.

The project's standing policy — *no outdated or superseded ADRs are kept in the tree;
delete and replace* — is recorded here as binding on future ADR work. It does **not** fire
on ADR-007, which is neither outdated nor superseded, and there are currently no superseded
ADRs in the tree for it to act on.

**Citation-reclamation scope.** The solution design (§ 9) anticipated that *all* of
`wait-for-post-load.ts`'s ADR-007 citations would move with this work. They do not, and the split
is the point rather than a shortfall — *citing* ADR-007 and *borrowing* ADR-007 are different
things. The rule, rather than a count that goes stale the next time either file is touched:

> A post-detail citation moves to ADR-008 when it invokes ADR-007 for **readiness or selector
> strategy** — the decision ADR-007 scoped to profile and `/company/` pages. It stays with
> ADR-007 when it invokes the **diagnostic-capture** pattern, which ADR-007 owns on every
> surface it names.

By that rule the post-detail readiness/selector-strategy citation moves, and the gate's own doc
comment now cites ADR-008 § Decision 1 as the normative source of the binding. Every
diagnostic-capture citation in that file stays with ADR-007 — which claims those call sites by
name in its 2026-05-05 and 2026-09-01 amendments — because re-pointing one would attribute to
ADR-008 a decision ADR-008 does not make. The same rule answers the two files this change does
not touch: `wait-for-reactions-modal.ts` cites ADR-007 for diagnostic capture and is therefore
already correct, while the post-detail unit-test comment carries a claim the binding made false.
Both are recorded in § Follow-ups. Adding an ADR-008 row to `CLAUDE.md`'s ADR table is additive.

**Unverified, flagged rather than assumed**: whether LinkedIn's variant flip also affects
**profile** pages is unprobed. ADR-007's `aria-label` anchors are plausibly more
flip-resilient than the `componentkey` attributes that vanished — but that is an inference,
not a measurement, and chasing it is out of this decision's scope.

## Alternatives Considered

| Alternative | Rejected because |
|---|---|
| Widen the selector unions in `selectors.ts` until they match both dialects | A union cannot report *which* dialect it matched, so it can build one record out of two dialects with no way to notice. It also keeps the gate variant-agnostic, leaving § 1's defect untouched |
| Per-field fallback — "try selectors until one yields non-empty" | Strictly worse than a union: it makes *empty* indistinguishable from *failed*, which is the exact defect being removed |
| Keep the `<main>` / `document` terminal fallback as a safety net | The fallback **is** the defect. It guarantees extraction runs against a scope whose field selectors match nothing, converting a detectable failure into a silent empty success |
| A boolean `isSdui` flag, or a closed `"sdui" \| "legacy"` union | Forces a type change and call-site changes to admit a third dialect, which ADR-007's weeks-to-months half-life says is a matter of when, not if |
| An environment variable, config flag, or dated migration to pin the dialect | The observed drift is non-monotonic and may be a per-session A/B bucket. Nothing set outside the page can be right for the page being read |
| Pick an adapter arbitrarily when two match | Builds a record from two dialects with no way to notice. Refusing is the whole reason the variant is modelled at all |
| Raise on zero adapters at the first gate probe | An un-hydrated page matches zero adapters too, so this fires on every slow load. The distinction is only decidable at the deadline |
| One new error class instead of three | Discards the routing information — register an adapter vs. repair a field vs. tighten a `detect` anchor are three different repairs |
| A single rule: "empty result implies stale selectors" | False-positives on every legitimate image-only and link-only post. This is why the container tier exists as a separate tier |
| Keep returning empty records and let callers decide | The caller cannot decide: an empty record from a stale adapter is byte-identical to an empty record from an empty post. That indistinguishability is the defect |

## Consequences

**Positive**

- A variant flip now surfaces as a typed error at the gate instead of an empty success. The
  failure mode that produced `commentCount: 41` alongside `comments: []` is closed.
- The error names the surface, the dialect and the field, so the next flip carries its own
  diagnosis. Detection probes report a per-variant match count — the diagnosis for the flip
  after that.
- Registering a third dialect is additive: one `VariantAdapter` appended to the surface's
  array, no call-site or control-flow change.
- The empty-vs-error contract is surface-agnostic, so a surface with no entry in the adapter
  registry (the reactions modal today) still gets the cardinal tier on its scrape path.

**Negative**

- **This is a live behavior flip for existing callers.** `get-post` and `get-post-engagers`
  now raise where they previously returned an empty list with a success status: the CLI exits
  `1` and MCP returns `isError: true`. Scripts that treat an empty list as a valid answer will
  break — that is the point of the change, and it is recorded in `CHANGELOG.md` under
  *BREAKING (runtime behavior)*.
- A page LinkedIn serves in a genuinely new dialect now **fails** rather than degrading. That
  is the intended trade — a loud failure over a silent wrong answer — but it means a flip
  causes an outage of the affected operations until an adapter is registered.
- The registry carries per-dialect extraction *source*, so two dialects mean two extractors to
  maintain, and a field change may need applying twice.
- Ambiguity is a real failure mode: a transitional page where both `detect` anchors match now
  raises. `detect` anchors must stay mutually exclusive, and that is a standing maintenance
  obligation rather than a one-time check.
- **One uncorroborated empty-success path survives on the reactions modal**, and it is recorded
  here rather than claimed closed. `get-post-engagers` returns `engagers: []` with a success
  status when its reactions-count element is not found — *before* the modal opens, and therefore
  before any cardinal exists to corroborate against. Two things make this a bounded residual
  rather than the same defect: the matcher is text-based (`N reactions`) rather than CSS-based, so
  it is materially more flip-resilient than the selectors that rotted; and on a genuinely
  zero-reaction post there is no count element to serve as a cardinal at all, so the tier is
  *structurally unavailable* on that path rather than merely skipped. Closing it needs the
  container tier the #830 spike is scoped to answer.

**Neutral**

- The former gate anchors are retained as diagnostics, so the timeout picture is *wider* than
  any single adapter's binding — deliberately, since a timeout wants to know how far the page
  got across both dialects at once.
- Detection adds one selector evaluation per registered adapter, once per operation, on a path
  that already performs a multi-second readiness poll. Immaterial.
- ADR-007's diagnostic-capture decision (§ 2026-05-05 Amendment) is unchanged and still governs
  `capturePostLoadFailure` in `wait-for-post-load.ts`.

## Follow-ups

- **Correct one stale unit-test comment**: `wait-for-post-load.test.ts` describes the
  `aria-label` interaction markers as *"the exact selectors the new readiness predicate uses"*.
  That claim is now false — those markers are diagnostic-only, and the predicate is bound to the
  selected adapter's own anchor (§ Decision 1). The needed edit is to correct the behavioral
  claim, not merely to re-point its ADR-007 citation. Comment-only, and it sat outside this
  change's ratified file list; fix it when that file is next modified.
- **`wait-for-reactions-modal.ts` needs no action.** Its ADR-007 reference is a
  *diagnostic-capture* citation, which ADR-007 owns; by the rule in § Citation-reclamation scope
  it must **not** be re-pointed. It is named here so a future maintainer working from a
  "remaining ADR-007 citations" list does not make exactly the wrong edit.
- **Register the reactions-modal surface**: the modal has no adapter entry, so it has no
  container tier and relies on cardinal corroboration alone. Whether it has a container tier at
  all is unprobed — see #830.
- **ADR-005's inline hierarchy tree** does not list the three subclasses added here. Reconcile
  it when ADR-005 is next amended; § 5 above is the authoritative record until then.
- **Probe the profile surface for the same flip**: currently an inference, not a measurement
  (§ Disposition of ADR-007).

## Amendments

### 2026-09-02 — The surface set is two: search results bound (#841)

`search-posts.ts` carried the same defect class this ADR was written for, and was missed by the
decomposition that produced it. It is an EXTRACTION operation, so it needed the full treatment —
variant tolerance *and* corroboration — rather than the mechanical selector-sourcing applied to
the action operations.

**What changed, stated as the two narrowings of the body above.**

`Surface` now admits `"post-detail"` and `"search-results"`, so § Decision 4's parenthetical
*"`Surface` admits only `"post-detail"`"* no longer holds. Everything it was supporting still
does: the reactions modal remains a surface with **no** registry entry, so it still has no
container tier and still degrades to the cardinal tier alone, and `"reactions-modal"` still
reaches the corroborator as a bare string naming the scraper rather than a dialect (#830 remains
open). Only the reason the sentence gave has moved on.

§ Decision 1's *"a readiness anchor MUST NOT be shared across dialects"* is **not** amended, but
it needs reading with its own rationale, because the search-results adapters deliberately share
one. The rule exists so that a gate cannot be blind to the change it is there to catch. The
readiness predicate is a CONJUNCTION — *exactly one adapter's `detect` matched* AND *that
adapter's own `ready` is present* — so on this surface the dialect binding is carried entirely by
`detect`, which is dialect-exclusive by measurement in both directions. `ready` carries the
orthogonal claim that a result CARD has hydrated, and the card skeleton is what the two dialects
share. Inventing a per-dialect hydration anchor would mean asserting a measurement nobody has
taken, which is the failure mode two rows down in this ADR's own § Consequences. The binding that
matters is preserved literally: the polled anchor is one the selected adapter's own extraction
REQUIRES — a card without a control menu is skipped by the card loop.

**The search-results binding.**

| | `sdui` | `legacy` |
|---|---|---|
| `detect` | `div[role="listitem"] [data-testid="expandable-text-box"]` | `[data-chameleon-result-urn]` |
| `ready` | `div[role="listitem"] button[aria-label^="Open control menu for post"]` | identical, per the paragraph above |
| `scopes` | `div[role="listitem"]` | `[data-chameleon-result-urn]`, then `div[role="listitem"]` |

`scopes` are reinterpreted for this surface — they are the CARD-ENUMERATION candidates, tried in
order, first candidate yielding at least one element wins, resolving to a LIST rather than to one
extraction root. The no-terminal-fallback rule of § Decision 3 is unchanged: an adapter that
enumerates no cards yields nothing and the page is reported unsupported. The legacy list's second
candidate is, today, a structural fallback that no page reaches — `detect` and `scopes[0]` are the
same selector — and it is recorded as such in the code rather than described as a live path.

Exclusivity is measured in both directions rather than argued: `[data-testid]` matched **0**
document-wide on the 2026-08-31 legacy post-detail probe, and `data-chameleon-result-urn` matched
**0** on the 2026-04-15 probe of the post-flip search page. Neither anchor can claim the other's
dialect, so selection cannot report a false ambiguity.

**Adapters now narrow per surface.** `VariantAdapter` carries what every surface has; a
`PostDetailVariantAdapter` adds `counts`, and a `SearchResultsVariantAdapter` adds nothing but
its surface. `counts` narrows the engagement-counts row of ONE post and a search page renders one
per card, so carrying it here as an empty array would be a field that gates nothing. The registry
is a mapped type over the surface set, which makes adding a surface without registering its
adapters a compile error and keeps each surface's adapter type at its call sites.

**The cardinal for this surface is `postCardCount`** — the number of enumerated cards that were
post-shaped **excluding the control-menu filter**: cards clearing the height floor AND carrying an
author link. There is no scraped-text cardinal here; the per-post `reactionCount` /
`commentCount` / `shareCount` are engagement counts, not a result-set total. Two properties hold
it in place, and § Decision 4's contract depends on both:

- **Non-vacuous.** Every other filter in the card loop is shared with the count, so the count and
  `posts.length` diverge on exactly one condition — the control-menu filter, which is the dominant
  suspected failure path. A cardinal defined as *"cards that yielded a post"* would always equal
  `posts.length` and could never contradict it: a corroborator that cannot fail.
- **Cannot false-raise on a genuinely empty search.** Chrome and "no results" blocks carry no
  author link and are not counted; and the `sdui` detect anchor is post-content-bound, so a
  zero-result page selects no adapter and never reaches the check. What such a page reaches
  *instead* is the readiness gate, which is the next paragraph.

It is asserted on the RAW scrape, after the scroll loop settles and BEFORE the cursor window is
sliced — the two ways an empty window is legitimate rather than evidence (§ Decision 4's
pagination rule, and a mid-scroll scrape taken while results are still streaming in).

**A zero match means something different here, and the diagnosis says so.** § Decision 3 and
§ Decision 5 both read zero-match as *LinkedIn changed; register an adapter*, and on post detail
that reading is sound because a post-detail page always has a post. This surface does not have
that property: a search that matched nothing renders no result cards, so no adapter's `detect`
anchor can match either, and a working page is reported unsupported.

The two states are genuinely indistinguishable **from the DOM** with what is measured today: no
live probe of a zero-result search page exists, so there is no measured "empty results" container
for either dialect to anchor on. Inventing one would put a *guessed* selector where § Decision 3
requires a decisive one — the same move as the always-true `<main>` fallback it removed, and as
the absence-of-`data-testid` discriminator this amendment records below. So the resolution is in
the DIAGNOSIS, not in the outcome:

- The **outcome is unchanged** — `DOMVariantUnsupportedError`, fail-loud. Returning `posts: []`
  would hand a caller an empty result it cannot tell apart from a dialect flip, which is what
  § Decision 4 exists to forbid, and softening the class would lose the operator action that is
  right in the first reading.
- The error's **`cause` states what was observed** — no registered adapter's detect anchor
  matched, with the per-adapter probe counts — and **names both readings** rather than letting the
  class's own wording assert the first. Tier-1 pins the text.

The qualifier is deliberately confined to the readiness gate, which is the only path a zero-result
search takes. The extraction-time `DOMVariantUnsupportedError` does **not** carry it: readiness
already went green there, so exactly one adapter matched a card moments earlier and the
markup-changed reading is sound again.

Two things this leaves open, recorded rather than resolved. Distinguishing the two states needs a
**live probe of a zero-result search page** — the measurement nobody has taken; until then the
error class over-claims by construction. And the `cause` reaches an in-process consumer and a Node
stack trace but **not the CLI or MCP text surface**, because `errorMessage()` renders `message`
alone; the same is already true of the post-detail gate's probe counts.

**The discriminator defect.** The replaced script chose its extraction strategy with
`searchItems.length > 0 && !document.querySelector('[data-testid="mainFeed"]')`. Under legacy
markup that negation evaluates TRUE — not because the condition it tests for holds, but because
the attribute scheme is absent entirely — so it took the wrong branch rather than failing. It is
the same class as the always-true `<main>` fallback § Decision 3 removed: **a check that cannot
fail is not a check.** The discriminator now asks the registry which surface and dialect the page
is speaking. With the negation gone, the script's second strategy was provably dead — it
enumerated a strict subset of the first strategy's items and its per-item body was otherwise
identical — and was deleted.

**Deliberately not done here, so a reader does not infer it.** This surface gets no diagnostic
capture (that is #835's pattern, and ADR-007 § 2026-09-01 Amendment owns it), and its engagement
counts are still parsed unanchored from each card's own text rather than by the anchored
per-element read post detail moved to. Both are follow-up candidates, not part of this binding.

**And it has no Tier-2 coverage at all.** `dom-variant.integration.test.ts` exercises post detail
in a real browser and does not mention this surface, so every claim here rests on Tier-1 against a
hand-built stand-in for the page, plus the provenance below. That is a gap rather than an
oversight of scope — the item asked for Tier-1 — and it is worth naming because a stand-in cannot
falsify a belief about the DOM; only the page can. This surface has already been caught that way
once: `24052dd` exists because a live check found `span[dir="ltr"]` matching **0** per post here
while the code confidently read it. A Tier-2 fixture pass is the natural companion to the
zero-result probe above, and the two would close the same class of unknown.

**Provenance, because the two dialects do not have equal evidence behind them.** The `sdui`
extraction is measured — the 2026-04-15 live probe of `/search/results/content/` recorded the
expandable text box present once per post and the `<p>` run of the second author link carrying
name, degree, headline and timestamp, on the same page where `span[dir="ltr"]` matched 0 per post.
The `legacy` extraction is **reconstructed, not probed**: no live legacy probe of a search-results
page exists, and it is rebuilt from the 2026-03-26 selector study plus the diff of commit
`24052dd`, the migration that replaced exactly that field logic. One thing from that diff is
deliberately NOT restored — its span-based name read, which was already broken (the first author
anchor on a card is avatar-only) and whose brokenness is *why* that commit moved the name onto the
control menu's `aria-label`. The name comes from the shared card skeleton, for both dialects.

## Related

- Code: `packages/core/src/linkedin/dom-variant.ts`,
  `packages/core/src/linkedin/corroboration.ts`,
  `packages/core/src/cdp/wait-for-post-load.ts`,
  `packages/core/src/services/errors.ts`,
  `packages/core/src/operations/get-post.ts`,
  `packages/core/src/operations/get-post-engagers.ts`,
  `packages/core/src/operations/search-posts.ts` (§ 2026-09-02 Amendment)
- ADRs: [ADR-005](005-error-hierarchy-design.md) (error hierarchy this extends),
  [ADR-007](007-profile-ready-selector-strategy.md) (precedent instance on the profile surface;
  unmodified and still in force there)
- Requirements: `docs/requirements/linkedin-dom-variant-tolerance-prd.md` (FR-13 / AC-13)
- Design: `docs/design/linkedin-dom-variant-tolerance-solution-design.md` (§ 4.3, § 7.1, § 9)
- Issues: #823 (the silent-empty report), #831 (adapter registry), #832 (typed extraction
  errors), #834 (fail-loud), #839 (this ADR), #841 (search-results binding, § 2026-09-02
  Amendment), #830 (reactions-modal container tier, open)
