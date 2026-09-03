# ADR-008: Post-Detail Readiness Binding and the Empty-vs-Error Contract

## Status

Accepted (2026-09-01)

This ADR governs the **post-detail** surface: the readiness gate in
`packages/core/src/cdp/wait-for-post-load.ts` and the extraction it gates in
`packages/core/src/operations/get-post.ts`. It also states the empty-vs-error
contract for every extraction surface, including
`packages/core/src/operations/get-post-engagers.ts`. It was subsequently bound to the
**search-results** surface (`packages/core/src/operations/search-posts.ts`), and then to the
**reactions-modal** surface (`packages/core/src/cdp/wait-for-reactions-modal.ts` and the extraction
it gates in `get-post-engagers.ts`) — see § Amendments.

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

> **Overtaken by events on 2026-09-03, and the two paragraphs above are exactly the record of why.**
> #828 and #838 both landed, the legacy post-detail adapter became the first to be graded against
> real captured markup, and the first of the two unmeasured halves named above turned out to be
> **false**: the shipped anchor matched zero on a real legacy page. Left in place rather than
> rewritten, because a regression diagnosed against "what was actually known" needs the prose that
> said so. See § Amendments → *The legacy detect anchor read the wrong attribute* (#872).

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

> **The container's attribute is `data-urn`, not `data-id`** — corrected 2026-09-03. The point
> this paragraph makes about scoping is unaffected; only its illustration was wrong, and it is
> left as written because it is the illustration a reader would otherwise copy. See § Amendments →
> *The legacy detect anchor read the wrong attribute* (#872).

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

> **One registered surface departs from the zero-match row of the first table, and it is a
> RULE-level exception rather than an example-level one.** On `reactions-modal`, zero matches
> RETURNS EMPTY and does not raise. Ground: `detect` on that surface is the reactions TRIGGER, not
> the modal, and a post with no reactions renders no trigger — so a zero-match page has a third,
> ordinary reading the other two surfaces do not have, and raising would throw on every such post.
> Everything else in this section is unchanged there, ambiguity above all: two or more adapters is
> still a hybrid page and still raises. Do NOT generalize the exception when registering a fourth
> surface — it is earned by the affordance being OPTIONAL on a page that otherwise reads fine, and
> it rests on a premise recorded as reasoned rather than measured. See § 2026-09-02 Amendment
> (#840), and § Consequences for the residual it leaves open.

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

  > **Superseded in its example, not in its rule.** The reactions modal was bound to the registry
  > on 2026-09-02: it has two adapters, it carries BOTH tiers, and #830 is answered — it does have
  > a container tier. The rule above still holds for any surface that has no entry; there is no
  > longer a registered surface serving as its example. See § Amendments → *The reactions modal has
  > a container tier; the surface set is three* (#840).

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
  *(The rule holds; its example does not — the reactions modal was registered on 2026-09-02 and
  now carries both tiers. See § Amendments (#840).)*

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
  **Narrowed and re-justified on 2026-09-02, NOT closed** (#840, § Amendments). What changed is the
  reason to accept the path, not the path: it still returns `engagers: []` with a success status
  when the trigger is not found, still *before* the modal opens, and therefore still before any
  cardinal exists. The container tier the spike delivered runs on the OPEN modal and never executes
  on this branch at all. What the registration bought is a better argument for the same outcome —
  the trigger is now matched on its accessible name per dialect rather than by document-wide text,
  so a not-found trigger is much likelier to mean *no affordance is rendered*.
  Two bounds keep this open rather than closed. That premise — a zero-reaction post renders no
  `[data-reaction-details]` at all — is **reasoned, not measured**; the 2026-09-02 probe covered a
  post WITH reactions. And "no affordance on the page" is not the only way to reach the branch: the
  trigger source also returns `false` when an adapter DID claim the page but no candidate satisfied
  the accessible-name rule, which is a stale-rule reading wearing the same return value.
  **Falsifier**, stated here rather than only in the amendment body: a live DOM probe of a
  zero-reaction legacy post. If it renders a trigger reading `"0 reactions"`, the branch is
  unreachable there and the modal opens on an empty list instead — which the container tier then
  handles correctly. One probe also settles the document-wide-`detect` residual recorded in that
  amendment.

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
- ~~**Register the reactions-modal surface**~~ — **done** (#840, § Amendments). #830 is answered:
  the modal has a container tier, it is registered with a `legacy` and an `sdui` adapter, and it
  now carries both tiers. What that amendment leaves open is narrower and stated there: a live
  probe of a zero-reaction post, and a measured SDUI modal wrapper.
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

> **Superseded the same day, by the amendment below.** Every clause of the previous paragraph about
> the *reactions modal* was true when written and is now false: the modal was registered later on
> 2026-09-02, it has two adapters, it carries both tiers, and #830 is answered. What the paragraph
> was actually establishing — that widening `Surface` did not by itself change the corroboration
> contract — still stands. See § Amendments → *The reactions modal has a container tier; the surface
> set is three* (#840). Left in place rather than rewritten: amendments are append-only, and the
> sequence in which the two surfaces were bound is itself the record.

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

### 2026-09-02 — The reactions modal has a container tier; the surface set is three (#840)

Spike #830 is answered, and the answer is **yes**: the reactions modal has a container tier. The
modal was accordingly bound to the registry as a third surface, which closes the engagers half of
#823 and the residual this ADR's own § Consequences recorded as bounded-but-open.

The measurement is one live legacy post-detail page (2 reactions, 41 comments, CDP 62104,
2026-09-02). Under that markup the modal renders as

```html
<div data-test-modal role="dialog" tabindex="-1"
     class="artdeco-modal artdeco-modal--layer-default social-details-reactors-modal"
     size="medium" aria-labelledby="social-details-reactors-modal__header">
```

and `.social-details-reactors-modal`, `#social-details-reactors-modal__header`,
`[data-test-modal]`, the heading text *Reactions* and four `[role="tab"]` / `[role="tablist"]`
matches were **all** present independent of what the list held. (The probe recorded the COUNT, not
the NESTING, and the adapter binds `[role="tablist"]` with a DESCENDANT combinator — so containment
is *implied* by the measured `aria-labelledby="social-details-reactors-modal__header"`, which names
a header the wrapper labels, and is not itself measured. See the residual list below.)
That independence is the whole finding: an anchor that only appears once rows exist cannot
distinguish *the modal opened and there is nobody in it* from *the modal opened and we can no longer
read it*, which is precisely the distinction § Decision 4 asks the container tier to make.

**What changed, stated as the narrowing of the body above.**

§ Decision 4's last bullet is **corrected, not merely dated**. It said a surface with no registry
entry degrades to the cardinal tier alone, that the reactions modal is such a surface, and that
whether it has a container tier at all is unprobed. The general rule still holds. Its running
example does not: `Surface` now admits `"post-detail"`, `"search-results"` and `"reactions-modal"`;
the modal has two registered adapters; `"reactions-modal"` reaches the corroborator as a surface
name backed by a selected dialect rather than as a bare string naming the scraper; and it now
carries **both** tiers, enforced the same way post-detail enforces them — the container tier
structurally and upstream, the cardinal tier as a per-field check. § Follow-ups' *"Register
the reactions-modal surface"* is closed by this amendment. § Consequences' *"One uncorroborated
empty-success path survives on the reactions modal"* is **narrowed and re-justified, not closed**:
that path returns before the modal opens, so the container tier delivered here never executes on
it — what improved is the argument for accepting the same outcome. It is restated at that bullet,
with its falsifier. § Follow-ups'
*"`wait-for-reactions-modal.ts` needs no action"* remains correct **on its own subject** — that
file's ADR-007 citation is a diagnostic-capture citation and was not re-pointed — even though the
file was otherwise rewritten here.

**The reactions-modal binding.**

| | `sdui` | `legacy` |
|---|---|---|
| `detect` | `button`, `[role="button"]`, `span`, `a` within the two SDUI post roots (one measured, one inferred — see below) | `button[data-reaction-details]` |
| `ready` | `button[aria-label$=" All reactions"]` | `[role="tablist"]` within either modal scope |
| `scopes` | `dialog`, then `[aria-modal="true"]` | `.social-details-reactors-modal`, then `[aria-labelledby="social-details-reactors-modal__header"]` |
| `rootSignal` | `button[aria-label$=" All reactions"]` | `[role="tablist"]` |
| `extract` | the #773 tab-anchor ancestor walk | an explicit `null` — nothing left to resolve |

**`rootSignal` is a field this surface adds, and it is the reason a scope candidate is not simply
the first match.** Every other surface's scopes name the thing they wrap — `[data-id^="urn:li:activity:"]`
(corrected to `[data-urn^=…]` on 2026-09-03; see § Amendments → *The legacy detect anchor read the
wrong attribute*, #872 — the claim being made here is about scopes NAMING what they wrap, which the
correction does not disturb), a chameleon result container. A modal-root candidate does not: `dialog` and `[aria-modal="true"]`
match any modal on the page, a CLOSED `<dialog>` included, and the legacy wrapper may be rendered
alongside unrelated overlays. So the resolver iterates EVERY match of every candidate and accepts
only one that CONTAINS this anchor. Both failures it closes are silent-to-loud in the wrong
direction: an overlay with no engager rows scrapes to `[]` and the cardinal tier raises on a modal
that opened perfectly, and an overlay that does hold `/in/` links returns people who never reacted
with `extractedCount > 0`, so nothing raises at all. The requirement is not new — the pre-registry
resolver states and implements it (`RESOLVE_REACTIONS_MODAL_SCRIPT`, #773); the registry port kept
the candidate list and dropped the gate. It is per-ADAPTER rather than that resolver's cross-dialect
union because a union cannot report which dialect it matched, which is why this surface was
registered at all — and each dialect's signal is the same anchor its own `ready` polls, so a
candidate cannot pass one check and fail the other.

**`detect` is the TRIGGER, not the modal.** Every other surface detects the thing it extracts from.
This one cannot: the modal does not exist until something is clicked, and the click needs a dialect
decision before there is a modal to decide from. The affordance that opens it is present on the post
page **both before and after** the click, so one anchor serves pre-click selection and still keeps
the readiness conjunction of § Decision 1 honest post-click — *exactly one adapter's `detect`
matched* AND *that adapter's own `ready` is present*. No new selection machinery, and the same
invariant.

Exclusivity is measured in one direction and reasoned in the other, which is weaker than the
search-results binding and is recorded as such: `[componentkey]` matched **0** document-wide on the
**2026-08-31** legacy-reversion probe — a different probe from the 2026-09-02 one everything else
here rests on, and cited by its own date because it is the only measurement of that attribute — so
the SDUI candidate set cannot claim a legacy page. The converse — `data-reaction-details` matching 0
under SDUI — is an inference from the attribute scheme, not a measurement, because LinkedIn is not
serving SDUI to this account.

Two narrower points inside that, because "measured" has to mean the thing that was measured. The
count above is of `[componentkey]` ALONE; the second SDUI root, `[data-sdui-screen="…"]`, has no
recorded count anywhere, so its non-match under legacy is an inference from the same attribute
scheme rather than an observation. And what either direction being wrong costs is a total outage
rather than a degraded read: both reactions-modal adapters would claim the page and every post of
the affected dialect would raise `DOMVariantAmbiguousError`. Both are stated on the adapters
themselves so a maintainer diagnosing that outage is not working against a comment claiming the
collision was measured impossible.

Precision does not live in the `detect` selector on this surface. It lives in a **shared
accessible-name rule** applied to whatever `detect` yields: `/^(\d[\d,]*)\s+reactions?$/i` matched
against `aria-label` **first**, then the element's own text, with a visibility floor. Both halves of
that rule are measured, one per dialect — legacy puts the words in `aria-label`, SDUI (per the #773
capture) put them in the element's text — so the rule is the union of two observations rather than a
guess covering both.

**`extract` is reinterpreted on this surface as the dialect's own modal-root resolver** — an
undictated decision, taken because the alternative was worse in a specific way. SDUI's modal carries
no selectable wrapper anyone has measured; the only recorded way to reach it is #773's walk upward
from the *All reactions* tab. Deleting that walk would leave the SDUI adapter unable to resolve a
scope, which under § Decision 3 means the surface raises on every SDUI page — a regression dressed
as a simplification. Keeping it as a *global* fallback would put a guessed anchor back in the
selection path, which is the always-true-`<main>` failure this ADR removed. Making it the SDUI
adapter's **own** algorithm, consulted only when that adapter's `scopes` all miss, keeps it exactly
as wide as the evidence for it: `extract`'s own contract already says that is where per-dialect
*algorithm* differences belong. Legacy's resolver is a literal `null` rather than a copy of the
walk, because the walk is **measured dead** there — its anchor matched 0 with the modal open.

**Zero `detect` returns empty; it does not raise** (contra § Decision 3, deliberately). On
post-detail and search-results a zero-match page has two readings and this ADR resolves both toward
*LinkedIn changed*. Here there is a third, and it is the ordinary case: **a post with no reactions
renders no reactions affordance**, so a working page matches nothing. Raising would throw on every
such post. Two or more adapters matching is still a hybrid page and still raises
`DOMVariantAmbiguousError` — that reading has no benign third alternative.

The premise is **reasoned, not measured**: the zero-reaction case was not observed, and the probe
covered one post that had two reactions. Its falsifier is cheap and specific — a live DOM probe of a
zero-reaction post. If such a post *does* render a `[data-reaction-details]` trigger, this branch is
unreachable there and the argument for it weakens to the SDUI candidate set alone.

**The held test's disposition is CONFIRM-AS-CONTROL, not invert.** #827's oracle left
`get-post-engagers.test.ts:199` — trigger absent ⇒ `engagers: []`, `total: 0`, no throw — deliberately
alone, pending this spike. The spike's answer is that today's asserted behaviour is the *correct*
behaviour, for the reason in the paragraph above, so applying the disposition required **no edit to
that file**: the test is promoted from held to a third control alongside the two the oracle already
carries. This is recorded here and in a comment on the branch itself so that a later reader can tell
a decision was taken from a step that was skipped — the two look identical in a diff.

**The three legacy defects this closes, in the order they fired.**

1. **The modal was never opened.** The finder scanned `button, [role="button"], span, a` for
   `textContent` matching `/^\d[\d,]*\s+reactions?$/` and matched **nothing**: the trigger's text is
   the bare `"2"`, and the word *reactions* exists only in `aria-label`, with `<img>` reaction icons
   in between. So the operation took its trigger-absent early return and reported `engagers: []`,
   `total: 0` on a post with two reactions. That is #823 on this path, and it was the dominant
   defect — the two below could not even be reached.
2. **The tab-anchor fallback was dead.** Against the shipped resolver, `dialog` matched 0,
   `[aria-modal="true"]` matched 0, `[role="dialog"]` matched 1, and the
   `button[aria-label$=" All reactions"]` fallback matched 0. One generic wrapper was load-bearing
   alone, and the fallback that exists for when wrappers rot would not have fired. Both are now
   per-adapter: legacy binds to its semantically-named wrapper, and the tab anchor is SDUI's, where
   it was measured.
3. **The modal total returned 0 with two engagers on screen.** It required `"All (2)"` **with**
   parentheses; legacy renders `"All 2"`. Parentheses are now optional, and the read prefers a
   cardinal captured earlier — see below.

**The cardinal is captured off the trigger PRE-click and read back POST-click.** The find call
already marks the trigger element; it now also stamps the cardinal parsed from the trigger's
accessible name, and the modal-total call reads that stamp back, falling through to the modal's own
`N reactions` / `All (N)` / `All N` runs when the stamp is absent or unparseable. This is not a
preference about tidiness: the success-path `Runtime.evaluate` sequence is pinned by the uneditable
oracle at *N readiness polls, one find, N modal-readiness polls, one total, one scrape*, so a
separate pre-click read of the cardinal was not available at any price. Riding it on two calls that
already exist costs nothing.

**The container tier is enforced structurally, upstream, exactly as on post-detail.** The scrape now
returns `RawEngager[] | null`: `null` means no adapter claimed the modal or no scope resolved ⇒ the
page was not read ⇒ raise. A non-null **empty** array means the container resolved and there were no
rows ⇒ the cardinal tier decides. The replaced code coalesced with `scraped ?? []`, which erased
exactly that distinction and is why the container tier could not be enforced before the surface was
registered.

**A consequence for the pre-authored oracle, recorded because it cannot be fixed in place.** #827's
`scrapeSequence: [null]` fixture is titled *"…but totalReactions contradicts it"* and asserts a bare
`.rejects.toThrow()`. Adding the container tier moved that fixture's refusal one tier earlier: `null`
is now refused before `total` is consulted, so the fixture passes identically with
`totalReactions: 0` and no longer discriminates on the cardinal its title names. It is still a
correct MUST-THROW pin, so it keeps its place among the controls — but that file is uneditable, so
the discrimination was re-established next door in
`get-post-engagers-extraction-diagnostics.test.ts`, by CLASS: `null` ⇒ `DOMVariantUnsupportedError`
with a corroborating `totalReactions: 0`, empty-array ⇒ `ExtractionFailedError`. Only the class says
which tier refused, which is exactly what the bare `toThrow` cannot.

**Readiness deliberately moved DOWN a tier, from rows to container.** The old predicate polled for an
engager link. That anchor cannot go green on a modal with no engagers in it, so a genuinely-zero
modal would have timed out and been reported as a failure — the same empty-vs-error confusion this
ADR exists to remove, inverted. The predicate now stops at the container tier and lets the cardinal
tier decide, which is the weaker gate and the correct one: readiness answers *can we read this
page*, never *does it have content*.

**And the wait that move deleted is re-paid at the cardinal tier, not skipped.** A container-tier
gate goes green while the reactor payload may still be arriving, which is exactly why the
post-detail adapters gate on a STRICTER-than-container anchor — *"a container can be present in a
skeleton state before the post body hydrates"*. This surface cannot copy that: a stricter anchor
here is the row-tier predicate just removed. The collect loop cannot absorb it either, because a
modal with zero rows has no scrollable region, so the scroll declines on the first attempt and the
loop breaks after ONE scrape. So `get-post-engagers` re-reads the modal a bounded number of times
*before* the cardinal tier is allowed to raise, gated on `contradictsEmptyExtraction` — false the
moment a single row was scraped, so a healthy run and a legitimately empty one spend no additional
`Runtime.evaluate` and the pinned success-path call budget is untouched. Without it, a modal
mid-hydration raises `ExtractionFailedError` non-deterministically against a diagnostic bundle
showing a perfectly healthy open modal, naming a selector repair that is not needed.

**The re-read sits INSIDE the collect loop, immediately after the scrape, and its budget is global
to the collect.** Both halves are load-bearing. Placed after the loop, a re-read that SUCCEEDS never
returns to it, so pagination is skipped entirely: a 50-reaction post whose modal hydrates slowly
answers with however many rows happened to be in the DOM on the re-read, reporting `paging.total:
50`, no scroll attempted and no error — the cardinal check passes the moment `extractedCount > 0`,
so the under-collection is silent and reads as a successful call. Placed inside with a
per-iteration counter, the budget refills on every scroll attempt and the settle becomes a retry
loop. The counter is therefore hoisted out of the loop, and Tier-1 fixtures pin both: that a
successful re-read falls through to the scroll path, and that the total re-read count across a
21-iteration collect is still `EMPTY_SCRAPE_SETTLE_ATTEMPTS`.

**One rule, two entry points.** `assertCardinalCorroboration` was split into a
`contradictsEmptyExtraction` predicate plus the assertion that raises it. `get-post-engagers` has to
know the verdict *before* the raise, because naming the dialect in the error costs a
`Runtime.evaluate` that the pinned call budget forbids on the success path and permits on the
failure path. Re-deriving the rule at that call site would have put two copies of one contract in two
files — the failure `corroboration.ts` exists to prevent one level down — so the rule stayed in one
place and grew a second door. A Tier-1 test pins that a healthy run spends no probe there.

**Provenance, because the two dialects again do not have equal evidence.** Everything legacy above
is measured on the 2026-09-02 probe. Everything SDUI is **reconstructed**: its `ready` anchor and its
modal walk come from #773's capture, which recorded the modal visibly open — which the click could
not have achieved had the trigger not been findable by text, and that is the whole basis for the
SDUI half of the accessible-name rule. Its `scopes` are generic ARIA wrappers, not a measured
LinkedIn anchor. No live SDUI page has been probed for this surface, and none can be while the
account is served legacy markup.

Two consequences follow directly from that walk's termination condition — it stops on an ancestor
**containing engager links** — rather than being discovered later.

The first is a limitation: an SDUI modal with genuinely zero engagers resolves no root and raises
instead of returning empty. Under legacy that case returns empty correctly, because the legacy scope
is the wrapper itself and does not depend on its contents. Fixing it needs a measured SDUI wrapper
anchor, which needs a live SDUI page.

The second is that **the termination condition is not a validation, and was briefly recorded as
one.** "Holds engager links" is satisfied by every ancestor up to and including `<body>` on any page
that lists people anywhere — the feed behind the modal is enough — so the walk could climb past the
modal and answer with the document body, after which the engager scrape reads the whole page and
returns strangers as reactors with `extractedCount > 0`, which no tier can contradict. The walk
therefore carries its own refusal: it rejects `body`, `html`, `head` and `main` as a result and
keeps climbing, which on a document-level ancestor means resolving nothing at all. Refusing is the
correct answer there — the caller raises, which is loud, where the alternative ships wrong data
quietly. A Tier-1 fixture pins it, and the residual is stated rather than claimed closed: an
INTERMEDIATE page wrapper that is neither a landmark nor the body (`<div id="app">`) still satisfies
the condition, so the refusal bounds the failure at the document level and does not eliminate it.
Eliminating it needs the same thing the limitation above needs — a measured SDUI container anchor —
at which point the walk stops being load-bearing at all.

**Residuals an independent review surfaced, recorded rather than closed, because closing any of them
needs a measurement nobody has.** Deliberately uncounted: the list is the record, and a count written
here goes stale the next time one is added or closed.

- **The legacy `detect` is document-wide where its SDUI sibling is root-scoped — and this residual is
  CONFIRMED REACHABLE BY PROBE, not merely reasoned.** On a post that has reactions it cannot
  mis-fire: the post's own counts row precedes every comment in document order and the first visible
  hit wins. The exposure is a ZERO-reaction post where some other `[data-reaction-details]` reads
  `"<N> reactions"`. An independent verifier probed exactly that shape on 2026-09-02 — a
  zero-reaction post whose COMMENT carries `aria-label="7 reactions"` — and the trigger source
  returns `true` and stamps a cardinal of 7. So the wrong control is clicked, its reactors are
  returned as this post's, and it *self-corroborates*, because the cardinal came off that same wrong
  control. Nothing downstream can detect it: both tiers see a consistent observation.
  It is nonetheless recorded rather than closed, and the decision NOT to narrow stands. Scoping to
  `.social-details-social-counts` would close it, and the element's own
  `social-details-social-counts__count-value` class says it is a BEM child of exactly that block —
  but the containment was never measured, and narrowing a working measured anchor on an inference is
  the move this ADR refuses everywhere else; get the inference wrong and extraction breaks outright,
  which is worse than the failure it prevents. The falsifier is unchanged and is deliberately the
  SAME probe as the zero-reaction premise above: one probe of a zero-reaction legacy post records
  whether any `[data-reaction-details]` renders at all AND whether the post's own trigger is a
  descendant of `.social-details-social-counts`, and answers both.
- **The legacy `ready` anchor's containment is implied, not measured.** The 2026-09-02 probe counted
  four `[role="tab"]` / `[role="tablist"]` matches but did not record their NESTING, while the
  adapter binds `[role="tablist"]` to a modal scope with a DESCENDANT combinator. The measured
  `aria-labelledby="social-details-reactors-modal__header"` implies the header — and with it the tab
  strip — is inside the wrapper, which is why this is low-probability rather than speculative. The
  verifier probed the failure it permits: with the tablist as a SIBLING of the wrapper rather than a
  descendant, readiness returns `false` — and since `rootSignal` was introduced, the extraction path
  is bound to that same anchor and rejects the same wrapper, so the scrape resolves no root and
  raises rather than quietly succeeding. Both halves now fail together, which is the intended
  coupling — readiness asks *has the modal's container rendered* and `rootSignal` asks *is this
  candidate that container*, and answering them with two different anchors is what would let a page
  pass one and fail the other. The consequence is unchanged in severity and sharper in shape: if
  LinkedIn ever portals the tab strip outside the wrapper, EVERY legacy `getPostEngagers` call fails
  on a modal that opened perfectly — at the readiness deadline, and at the container tier for
  anything that gets past it. Falsifier: the same live probe, recording the tab strip's ancestor
  chain rather than only its count.
- **The modal-total fall-through is structural under legacy, not the live fix.** Because the trigger
  stamp always parses, step 1 always returns and the `"All 2"` read is unreachable on legacy in
  production — it stays for SDUI, whose broad `detect` can survive losing the marked element. So the
  parenthesis fix is correct and Tier-1-pinned, but on legacy DEFECT 3 is already headed off one step
  earlier. Its reads are also UNANCHORED — they flatten the modal, the read post detail abandoned —
  which on the SDUI path is a live over-match risk (an engager headline reading *"overall 20 years"*
  satisfies the `"All"` pattern). Anchoring it needs a measured SDUI count element.
- ~~**A reactions modal caught mid-hydration under-collects silently, and the contract is why.**~~
  **Falsifier run, residual CLOSED** (#874, § Amendments → *A short reactor collection is reported,
  not raised*). It read: `contradictsEmptyExtraction` short-circuits on ANY non-zero extraction, and
  that one predicate gates BOTH the settle re-read and the cardinal raise, so a first scrape landing
  with 3 of 50 rows spends no settle re-read and cannot be contradicted afterwards either — the
  scroll declines, the collect loop breaks, and the call returns 3 engagers with `paging.total: 50`,
  an HTTP success and no error. Its falsifier was *a live measurement of whether the reactor list
  sits in a container that overflows at a SMALL row count*; the measurement CONFIRMED the residual
  rather than narrowing it, and put a number on the window. The premise that no repair was available
  under the uneditable oracle was the part that did not survive: it held only for repairs that
  RAISE, and reporting was never tried.

**Deliberately not done here, so a reader does not infer it.** The trigger-absent branch does not
attempt to distinguish *no reactions* from *trigger selector rotted*; the evidence to do so does not
exist yet (see the falsifier above). Engagement-count parsing elsewhere is untouched. And this
surface, like search-results, has **no Tier-2 coverage** — every claim above rests on the live probe
plus Tier-1 against a hand-built stand-in, and a stand-in cannot falsify a belief about the DOM.

### 2026-09-03 — The legacy detect anchor read the wrong attribute (#872)

The first of the two unmeasured halves recorded in § Context is **falsified**. It was stated there
as *"that at least one of the 40 hits is an `activity:` container (if they are all comments, the
adapter claims nothing and a legacy page is reported unsupported)"*. They are all comments. The
parenthetical is what actually happened.

**What was wrong.** `LEGACY_UPDATE_CONTAINER` shipped as `[data-id^="urn:li:activity:"]`. Measured
against the two committed fixtures (#828), that selector matches **zero** elements on a real legacy
post-detail page, so the adapter never claimed the pages it exists to serve: detection returned
`{matched: [], probes: {sdui: 0, legacy: 0}}`, readiness stayed `false`, and extraction returned an
empty record. The defect this ADR was written to remove was still present on the legacy path after
the migration that removed it.

**The root cause generalises past this one anchor, which is why it is recorded here rather than
only in the issue.** LinkedIn uses **both** attributes on a legacy page, split by ENTITY CLASS and
not by dialect:

| Element | Attribute carrying the URN | URN family |
|---|---|---|
| `.feed-shared-update-v2` — the update container, i.e. the extraction root | **`data-urn`** (`data-id` is `null`) | `urn:li:activity:` |
| comment entities (40 of them on `post-with-comments`) | **`data-id`** | `urn:li:comment:` |

So the live measurement of `[data-id^="urn:li:"]` matching 40 was never evidence that an *activity*
container was among them — the attribute itself selects the comment class. The narrowing recorded in
§ Context was reasoning correctly about the entity (a comment is not an extraction root) on the
wrong attribute, and the measurement it leaned on could not have distinguished the two.

**Rule for any future adapter**: an anchor naming a `urn:li:activity:` value reads `data-urn`; one
naming a `urn:li:comment:` value reads `data-id`. Guessing between them fails **silently** — a
zero-match adapter simply does not claim the page, so the wrong attribute surfaces as *"dialect
unsupported"* rather than as a selector error. That is the same silent shape as the original defect,
one level down, and § Decision's detect/scope coupling converts it into that shape by design: the
coupling buys a guarantee that no caller receives a false empty record, and buys nothing at all
towards telling a broken selector apart from an unregistered dialect.

**What changed.** `LEGACY_UPDATE_CONTAINER` now reads `[data-urn^="urn:li:activity:"]`. `ready` and
`scopes` are derived from the same constant and needed no separate edit. The union form
`'[data-id^=…], [data-urn^=…]'` was considered and **not** taken: no measured page uses `data-id`
for an activity URN, so the union would be a selector union of exactly the kind this ADR argues
against, resting on a page nobody has seen.

**A second copy of the same wrong belief, found by the fix.** `dom-variant.integration.test.ts`
hand-writes its legacy container as `data-id` in a `LEGACY_CONTAINER` constant. That hardcoding is
deliberate and stays — deriving the markup from the adapter would make the tier assert against a
page authored from the anchor under test — but it means the description was independently wrong in
the same way, and nine of its selection assertions went red on the corrected anchor. Corrected in
place. The lesson is narrow and worth keeping: a hand-written stand-in is independent of the
adapter's *code* and not of its *author's belief*, so it cannot witness this class of defect.

**What is now fixture-verified, stated as a bound.** The Tier-2 oracle
(`__tests__/fixture-oracle.integration.test.ts`, #838) asserts on both fixtures that exactly the
legacy adapter claims the page, that readiness goes green, and that extraction returns a legacy
record whose author name and profile link are non-empty, whose text is non-empty, and whose two
engagement cardinals match the `.measured.json` sidecar exactly. Headline and timestamp are **not**
graded and remain the best hypothesis § Context describes. The two assertions carrying this — four
cases, one per fixture — landed as `it.fails` under #838 so that fixing the anchor would force a
visible acknowledgement rather than a silent absorption; they are plain `it` as of this change.

**The second unmeasured half is not closed — it moved.** The original worry was that `data-id` might
also appear on an SDUI page, so that both adapters claim it and extraction reports ambiguity.
Restated for `data-urn` it is the same worry with the same standing, and #828 captured legacy pages
only, so no fixture can settle it. What the legacy fixtures *do* settle is the opposite direction:
the SDUI adapter probes 0 on both, so a legacy page is unambiguous. The SDUI direction stays an
inference — better grounded than the falsified half was, since the SDUI rewrite replaced these
attributes with `componentkey` — but still without a recorded count. **Falsifier**: a captured SDUI
post-detail fixture, counting `[data-urn^="urn:li:activity:"]` document-wide.

### 2026-09-03 — A short reactor collection is reported, not raised (#874)

The under-collection residual recorded in § Consequences is **closed**. Its falsifier was run first,
and it came back the unwelcome way: the residual is real, reachable, and slightly wider than the
report guessed.

**The measurement.** Live probe on 2026-09-03 against a 227-reaction post under the legacy markup,
driving the operation's own trigger, readiness and scroll sources rather than a re-derivation of
them:

| Reading | Value |
|---|---|
| Cardinal read from the modal | `227` |
| Rows present when `waitForReactionsModal` returned green | `0` — pane `clientHeight: 56` |
| Scroll source at that moment | `false` (no overflowing div; fell back to the modal, `scrollTop` write a no-op) |
| Rows ~1.2 s later | `10` |
| Reactor pane once populated | `.artdeco-modal__content.social-details-reactors-modal__content`, `clientHeight: 476`, `max-height: none`, `overflow-y: auto` |
| Mean row height | `84 px` (range 71–107) |
| Rows the pane fits before overflowing | `5` |

So the falsifier's *"if the list sits in a short fixed-height container that overflows at a small row
count"* is **false**. The pane is bounded by the modal's layout at 476 px, which takes about six rows
to overflow; below that the scroll source finds no scrollable region at all and reports `false`,
which the collect loop reads as *reached the bottom*. **The silent window is one to five rows**, and
the same run observed the modal genuinely passing through a sub-window state — readiness green on an
empty 56 px pane. Zero rows is the case the #840 settle already covers; one to five is the gap.

Two further routes reach the same silence and never depended on hydration at all, which is why the
repair is not scoped to it: a reactor list that legitimately renders fewer rows than its own count
claims (blocked, deleted or restricted accounts), and exhaustion of the 20-scroll budget on a list
longer than roughly 119 rows.

**What changed.** A new predicate, `contradictsCompleteCollection`, beside
`contradictsEmptyExtraction` in `corroboration.ts`; a `shortfall` field at the top level of
`GetPostEngagersOutput`, carrying `collected`, `requested`, `cardinal` and `stoppedBecause`.

**Why report and not raise, stated as the asymmetry it is.** The two predicates answer different
questions and the answers are not two strengths of one rule. An empty scrape beside a positive
cardinal is evidence the SELECTORS broke — no caller can tell that record apart from a real empty
one, so it raises. A short scrape is evidence the COLLECTION stopped early; the rows that did arrive
parsed fine, so the selectors are not implicated and the caller is the party that can judge whether
the shortfall matters. Raising on it would fail a page that legitimately renders fewer reactor rows
than its count claims, converting a routine call into a stale-selector diagnosis pointing at
selectors that are fine.

That reading is what dissolved the recorded blocker. § Consequences held that closing this needed the
uneditable oracle amended first, because both candidate repairs turn "stops scrolling when modal is
at bottom" red. Both of those repairs RAISE. The oracle requires one engager against
`totalReactions: 5` to *return normally*; it says nothing about returning **quietly**, and the
distinction is the whole repair. Confirmed by mutation rather than asserted: a mutant that raises on
a short collection turns exactly two oracle cases red, and the oracle is unmodified — its blob still
hashes to `f3f94ab0481d`.

**Where the rule lives, and the one thing that surprised the design.** `contradictsCompleteCollection`
takes `extractedCount`, `requestedCount` and `cardinal`, and an earlier draft carried a fourth field,
a caller-asserted `collectionExhausted` flag. It was removed: a collector only ends BELOW what it
went for when it could not get more, so the flag could never vary and was ceremony. The `requested`
comparison is what keeps the signal off the ordinary pagination path — a caller asking for 5 of 227
and getting 5 has a complete answer to the question it asked, and firing there would make the signal
worth ignoring.

The cost of that placement is that the operation's collect loop excludes the satisfied exit *before*
the predicate is consulted, so the `requestedCount` guard is unreachable from the behavioural suite —
a mutant deleting it survived every operation-level test. It is graded in
`corroboration.test.ts` instead. Recorded because the general shape recurs: a guard that a caller
also enforces is not covered by that caller's tests.

**`shortfall` is present on every result, `null` when nothing contradicted the collection.** An MCP or
CLI consumer reads this as serialized JSON, and a field that vanishes on the healthy path is one
nobody learns to check. `stoppedBecause` names only what was observed — `scroll-declined` or
`scroll-budget-exhausted`. There is deliberately no `bottom-reached`: the modal declining to scroll
and the modal having nothing more to give are indistinguishable from outside it, since the scroll
source reports one `false` for both.

**`null` is the absence of a contradiction, never a certificate of completeness**, and an earlier
draft of this amendment said the second thing — that `"shortfall": null` "states that completeness
was checked and held". That claim is false on the two paths that reach `null` without ever reading a
cardinal: the trigger-absent return, and a modal whose own count is unreadable, where `total` falls
back to `0` and `0` cannot contradict any row count. Both correctly report `null` — there is nothing
to contradict — but neither verified anything, and a field asserting otherwise would certify exactly
where it knows least, which is strictly worse than the silence this amendment closed: before it, a
consumer had no signal; after a mis-stated one, it has a signal it is entitled to trust. The claim is
narrowed at all four places it is made — the field's own doc comment, the MCP tool description, the
README, and here. Recorded because the general shape recurs: a signal added to end a silence is
under pressure to promise more than its own predicate can see, and the predicate is the thing that
gets read later.

**Scope, stated so it is not re-litigated.** The discriminator BOUNDS detection: this contract fires
on a contradiction against a cardinal the page rendered, so where no cardinal is readable there is no
contradiction to find and nothing here fires. That is the deliberate reading of #874, whose own
mechanism is cardinal-based throughout. An empty result on a post that has reactions is a different
class — the recognition failure of #823, whose trigger-absent branch is dispositioned in the
§ 2026-09-02 Amendment — and it is not narrowed, widened, or re-opened here.

**The check costs no `Runtime.evaluate`**, which is a constraint rather than an optimisation — the
oracle pins the success-path evaluate sequence at 7 and 6 calls in its two polling cases.

**Deliberately not done, so a reader does not infer it.** An under-collection on a path with no
readable cardinal stays unreported, by the scope paragraph above — the two `null`-without-a-check
paths are named there rather than repaired, because repairing them means finding a second
corroborator, and this amendment deliberately adds no new `Runtime.evaluate`. The window is not
narrowed: nothing here makes the modal hydrate before readiness, and the settle still covers only
the all-empty case.
`get-post`'s comment collection is untouched and may carry the same shape — unmeasured, and not
assumed. The measurement above is one post, one dialect, one viewport (`innerHeight: 668`); the
five-row figure moves with the viewport, and it is the mechanism, not the constant, that the repair
rests on. And this surface still has **no Tier-2 coverage**: the reactions modal has no committed
fixture, so every claim here rests on the live probe plus Tier-1 against mocks.

## Related

- Code: `packages/core/src/linkedin/dom-variant.ts`,
  `packages/core/src/linkedin/corroboration.ts`,
  `packages/core/src/cdp/wait-for-post-load.ts`,
  `packages/core/src/cdp/wait-for-reactions-modal.ts` (§ 2026-09-02 Amendment, #840),
  `packages/core/src/services/errors.ts`,
  `packages/core/src/operations/get-post.ts`,
  `packages/core/src/operations/get-post-engagers.ts`,
  `packages/core/src/operations/search-posts.ts` (§ 2026-09-02 Amendment, #841)
- ADRs: [ADR-005](005-error-hierarchy-design.md) (error hierarchy this extends),
  [ADR-007](007-profile-ready-selector-strategy.md) (precedent instance on the profile surface;
  unmodified and still in force there)
- Requirements: `docs/requirements/linkedin-dom-variant-tolerance-prd.md` (FR-13 / AC-13)
- Design: `docs/design/linkedin-dom-variant-tolerance-solution-design.md` (§ 4.3, § 7.1, § 9)
- Issues: #823 (the silent-empty report), #831 (adapter registry), #832 (typed extraction
  errors), #834 (fail-loud), #839 (this ADR), #841 (search-results binding, § 2026-09-02
  Amendment), #830 (reactions-modal container tier — answered: it has one), #840 (reactions-modal
  binding, § 2026-09-02 Amendment), #872 (legacy detect anchor read `data-id` instead of `data-urn`,
  § 2026-09-03 Amendment), #874 (short reactor collection reported rather than raised,
  § 2026-09-03 Amendment)
