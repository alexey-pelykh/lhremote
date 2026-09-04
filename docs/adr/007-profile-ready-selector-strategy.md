# ADR-007: Profile and Company Page Readiness Selector Strategy

## Status

Accepted (2026-04-19); amended 2026-04-29 to extend the readiness selector's
empirical scope from member profile pages to LinkedIn organization
(`/company/{slug}/`) pages — see § Amendments.

## Context

`navigateToProfile` (`packages/core/src/operations/navigate-to-profile.ts`) synchronizes a just-issued CDP `Page.navigate` against the target profile's DOM being ready for subsequent interaction. `client.navigate()` is fire-and-forget at the CDP layer — it sends `Page.navigate` and returns immediately without awaiting load events — so a DOM-level selector wait is the only synchronization point before downstream detection queries run (`PROFILE_FOLLOWING_BUTTON_SELECTOR`, `PROFILE_MORE_BUTTON_SELECTOR`, etc.).

The original implementation used `main h1` with a 30-second timeout. On 2026-04-19, both profile-page E2E tests (`unfollow-profile`, `hide-feed-author-profile`) began failing with identical `Timed out waiting for element "main h1" after 30000ms` errors. Diagnostic instrumentation confirmed the profile page was otherwise healthy (correct URL, correct `document.title`, `<main>` present, Message/Follow buttons rendered) — LinkedIn simply no longer wraps the profile name in an `<h1>` element.

This is not an isolated failure. Combined with prior selector breakages observed in LinkedIn feed and profile automation, this incident reinforces that LinkedIn periodically removes or reshapes semantic markers in its DOM. Any selector strategy rooted in DOM headings or CSS class names has an expected half-life on the order of weeks-to-months.

## Decision

`PROFILE_READY_SELECTOR` is a **disjunction of profile action-button `aria-label` prefixes**:

```text
main button[aria-label^="Message"]
main button[aria-label^="Follow "]
main button[aria-label^="Following "]
main button[aria-label^="Connect"]
main button[aria-label^="Pending"]
main button[aria-label="More actions"]
main button[aria-label="More"]
```

Any single match indicates the profile card has hydrated far enough for follow-state detection, Mute/Unmute menu traversal, or any other interaction used by profile-based operations.

**Rule for future profile-area selectors**: prefer `aria-label` prefixes on interactive elements over DOM headings, CSS classes, or `data-view-name` values. When a new readiness signal is needed, extend `PROFILE_READY_SELECTOR` with additional action-button variants rather than falling back to structural selectors.

**Diagnostic instrumentation is first-class but opt-in**: `navigateToProfile` can capture `{ href, title, DOM probes, screenshot }` on `CDPTimeoutError`. Activation is gated on `LHREMOTE_CAPTURE_DIAGNOSTICS=1`; artifacts land under a per-invocation `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/` directory (created via `mkdtemp` for atomic TOCTOU-safe creation — see § 2026-05-05 Amendment) as `navigate-to-profile-{timestamp}-{publicId}.{json,png}`. E2E tests set this env var via `vitest.e2e.config.ts`, so every test run produces diagnostics without code changes. Production callers (CLI, MCP server) remain default-off — screenshots of LinkedIn profile pages contain personal data and must not be written silently. Future LinkedIn DOM changes are still classifiable (re-run with the env var set) without code changes.

## Consequences

**Positive**

- Survives LinkedIn DOM redesigns that preserve accessibility semantics (the common case). `aria-label` strings are i18n-anchored, not CSS-architecture-anchored.
- Single source of truth: the detection-button selectors in `unfollow-profile.ts` and `hide-feed-author-profile.ts` and the readiness selector share the same structural assumption.
- No dependency on profile content that varies by connection degree, privacy, or profile completeness.
- Next timeout produces classifiable evidence instead of opaque failure.

**Negative**

- **Locale coupling**: `aria-label^="Message"`, `Follow`, etc. are English-locale strings. Non-English LinkedIn sessions will not match. Acceptable for now (LH default locale is English); a locale-aware extension is required before internationalization.
- Selector is longer than a single heading selector; slightly noisier in logs and stack traces.
- **Self-profile edge case**: viewing one's own profile shows no action buttons. Out of scope — profile-write operations (unfollow, mute) cannot target self.

**Neutral**

- Existing selectors in `unfollow-profile.ts` and `hide-feed-author-profile.ts` that already use `main button[aria-label^=...]` patterns need no change; they are consistent with this decision.

## Follow-ups

- **Generalize diagnostic capture**: The current capture lives inline in `navigate-to-profile.ts`. When a second CDP operation needs the same pattern, lift it to a shared helper (e.g. `packages/core/src/cdp/diagnostics.ts`) keyed on the same `LHREMOTE_CAPTURE_DIAGNOSTICS` env var. Not worth doing for a single call site.
- **Locale-aware readiness**: When a non-English LinkedIn locale enters scope, extend `PROFILE_READY_SELECTOR` with localized `aria-label` prefixes (or key off a locale-independent attribute if one emerges).

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| `main` alone | Matches before content hydrates — races with the downstream detection query. |
| `main section.artdeco-card` | Depends on CSS class (`artdeco-card`); LinkedIn has redesigned card classes before. |
| `main div[data-view-name="profile-card-recent-activity"]` | Activity card is absent on profiles with no recent activity. |
| New heading selector (e.g. `.text-heading-xlarge`) | Same failure class as `h1` — locks us into whichever class LinkedIn ships this month. |
| Wait for `Page.loadEventFired` then short delay | SPA client-side routing fires load events before the profile data resolves. |
| `waitForEvent("Page.frameStoppedLoading")` | Same root issue — SPA navigations don't always trigger frame load events. |
| Keep `main h1` + fall back | Adds latency on every run once the primary selector is known-dead. |

## Amendments

### 2026-04-29 — Company-page coverage (`navigateToCompany`)

`navigateToCompany` was added alongside `navigateToProfile` to support
unfollowing LinkedIn organization pages (`/company/{slug}/`) — see
issue #757. Both functions reuse `PROFILE_READY_SELECTOR` because the
selector's CSS-disjunction semantics make the profile-only variants
(`Message`, `Connect`, `Pending`) unreachable on company pages without
producing a false positive — they simply do not match. `Follow `,
`Following `, and the `More` / `More actions` overflow buttons are
present on both surfaces and provide the readiness signal.

**Empirical scope of this amendment**:

- The original 2026-04-19 study (this ADR's body) verified the
  selector against rendered profile-page DOM (`/in/{publicId}/`).
- The 2026-04-29 extension to company pages was justified analytically
  (CSS OR semantics + reporter testimony in issue #757 that "the
  Following toggle on company pages works the same way as on personal
  profiles") and verified at the unit level (mock-based dispatch
  tests) plus E2E-test infrastructure parameterized on
  `LHREMOTE_E2E_COMPANY_URL`. The empirical company-page DOM has not
  been studied with the same depth as profile pages — when the next
  selector regression occurs on company pages, the diagnostic capture
  (now kind-tagged: `navigate-to-company-{ts}-{slug}.{json,png}`)
  should produce evidence equivalent to the original profile-page
  study.
- If the empirical premise turns out to be false on company pages
  (e.g., LinkedIn renders `Follow company` instead of `Follow `, or
  exposes the toggle through a different aria-label shape), the
  remediation path is to extend `PROFILE_READY_SELECTOR` with the
  observed company-page variants, not to fork the selector.

**Diagnostic filename rule extends to company navigation**: artifacts
land at `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/navigate-to-{profile,company}-{timestamp}-{slug}.{json,png}`,
where the kind tag identifies which navigator timed out. Caller-label
in the `console.warn` line follows the same convention
(`[navigateToProfile]` vs `[navigateToCompany]`).

### 2026-05-05 — Diagnostic directory layout (TOCTOU mitigation)

The diagnostic directory layout originally documented above
(`${os.tmpdir()}/lhremote-diagnostics/`) was a single shared parent
across all captures. PR #770's review surfaced a TOCTOU concern: when
the shared parent pre-exists as a symlink another local user
controls, `mkdir(..., { recursive: true })` traverses that symlink
before any validation can run, so subsequent writes land in the
attacker's target directory.

The mitigation: switch from a shared parent + `mkdir(recursive: true)`
to a per-invocation `mkdtemp(${tmpdir()}/lhremote-diagnostics-)`. The
`mkdtemp` syscall generates the random suffix and creates the
directory atomically, refusing to follow any pre-existing symlink at
the prefix. Each capture invocation produces a guaranteed-fresh
directory at `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/`, so the
artifacts the caller's `console.warn` reports are always in a
directory the OS just created for that capture.

This applies symmetrically to:

- `captureProfileLoadFailure` / `captureCompanyLoadFailure`
  (`navigate-to-profile.ts`)
- `capturePostLoadFailure` (`cdp/wait-for-post-load.ts`, introduced
  by PR #770 as the second call site that triggered the ADR's
  "Generalize diagnostic capture" follow-up condition)

The `console.warn` lines and operator-facing E2E error messages
should use the per-invocation directory path returned by `mkdtemp`,
not a hard-coded shared parent path. Any documentation that still
references the shared `lhremote-diagnostics/` parent without the
trailing random suffix is stale and should be updated when next
modified.

### 2026-09-01 — Diagnostic capture is no longer timeout-only

The pattern above describes capture as timeout-triggered: `navigateToProfile`
on `CDPTimeoutError`, `waitForPostLoad` and `waitForReactionsModal` when their
polling deadlines expire. That framing made the directive this ADR exists to
serve — *inspect these artifacts before changing profile or post-detail
selectors* — **undischargeable for the defect class it most needed to cover.**

An extraction failure never reaches a deadline. The readiness gate goes green
in milliseconds, an adapter claims the page, the post body extracts fine, and
only then does the scrape contradict a count the same page rendered
(`commentCount: 41` alongside `comments: []`, observed live 2026-08-31). A
capture bound to a deadline cannot see that at all, so the one failure mode
that most needs an artifact produced none.

**Capture now fires on failure, not on timeout.** Three additions:

1. **A second trigger class.** Alongside the readiness timeouts,
   `getPost` and `getPostEngagers` capture when the extraction raises —
   `DOMVariantUnsupportedError` and `DOMVariantAmbiguousError` from the
   post-detail scrape, and `ExtractionFailedError` from cardinal
   corroboration. The capture happens at the operation call site, because the
   corroboration predicate is pure and holds no CDP client; threading one into
   it would turn a unit-testable predicate into an IO-bearing one.

2. **Trigger-derived artifact names.** The filename rule stated in the
   2026-04-29 amendment (`navigate-to-{profile,company}-{timestamp}-{slug}`,
   where the kind tag identifies which navigator timed out) is joined by
   `{trigger-stem}-{timestamp}` for the two page-reading captures:

   | Trigger | Stem | `console.warn` tag |
   |---|---|---|
   | readiness timeout, post detail | `wait-for-post-load` | `[waitForPostLoad]` |
   | readiness timeout, reactions modal | `wait-for-reactions-modal` | `[waitForReactionsModal]` |
   | extraction failure, post detail | `post-detail-extraction-failure` | `[postDetailExtraction]` |
   | extraction failure, reactions modal | `reactions-modal-extraction-failure` | `[reactionsModalExtraction]` |

   The timeout stems and tags are unchanged. The extraction-failure rows are
   deliberately **not** tagged with the wait function's name: that gate went
   green, and labelling the artifact for a timeout that never happened would
   send the next reader hunting a slow page that was never slow. The caller
   label stays a single identifier token, per the same amendment's convention.

   > **Extended on 2026-09-04** — this table gains two rows for the
   > search-results surface, which captured nothing at either of its failure
   > sites until #870. Nothing above changes. See § 2026-09-04 Amendment.

3. **Two bundle fields.** Every post-detail and reactions-modal bundle now
   carries `trigger`, because artifacts get copied out of their `mkdtemp`
   directory and a bundle that cannot say what it was capturing leaves its
   reader guessing. The post-detail bundle additionally carries
   `variantDetection` — `matched` plus the per-registered-adapter detect
   counts. That field is the diagnosis for the next dialect flip, and it is
   the one thing the fixed-selector probes structurally cannot supply: read
   with `matched`, it separates *nothing matched* (register an adapter) from
   *two or more matched* (hybrid page — tighten the detect anchors) from
   *exactly one matched* (the dialect is known; repair that field's
   selectors). `null` means the probe yielded no usable reading, which is not
   the claim that no adapter matched. The reactions-modal bundle carries no
   such field on purpose: that surface has no entry in the variant-adapter
   registry (#830), so there is nothing to probe and a fabricated field would
   be worse than none.

   > **Superseded on 2026-09-02** — the last two sentences only. The reactions
   > modal was registered by #840, so it has adapters, the probe runs, and its
   > bundle carries `variantDetection` exactly as the post-detail one does. See
   > § 2026-09-02 Amendment below.

**Unchanged, and load-bearing:** activation stays gated on
`LHREMOTE_CAPTURE_DIAGNOSTICS=1` at every site, on every trigger. Widening
what fires the capture must never widen who may write it — the artifacts
contain page content, i.e. personal data, and production callers (CLI, MCP)
remain default-off. The per-invocation `mkdtemp` directory, the `0o700`/`0o600`
modes, the cancellation cap, and the rule that a capture-side failure never
masks the caller's error all carry over untouched.

The `navigateTo{Profile,Company}` captures are out of scope here: they remain
timeout-only and their bundles carry no `trigger` field.

### 2026-09-02 — The reactions-modal bundle carries `variantDetection` too (#840)

Item 3 of the amendment above ends by stating, present-tense, that the
reactions-modal bundle carries no `variantDetection` **on purpose**, because
that surface has no entry in the variant-adapter registry (#830). That was true
when it was written and is false now. #830 was answered on 2026-09-02 — the
modal does have a container tier — and #840 registered the surface with a
`legacy` and an `sdui` adapter. So:

- the reactions-modal bundle **does** carry `variantDetection`, with the same
  `matched` plus per-registered-adapter probe counts the post-detail bundle
  carries, and it is read the same way (nothing matched ⇒ register an adapter;
  two or more ⇒ hybrid page, tighten the detect anchors; exactly one ⇒ that
  dialect's selectors went stale);
- `null` there still means the probe yielded no usable reading, and still is
  **not** the claim that no adapter matched;
- nothing else in item 3 changes. The `trigger` field, the artifact-name table,
  and the two trigger classes are unaffected.

This is corrected rather than merely dated because the superseded sentences
give an instruction — *do not add this field* — and the project's own
`CLAUDE.md` ends its failure-diagnostics paragraph by pointing a reader at this
amendment. A maintainer reconciling the two authorities would otherwise amend
the CODE to match the ADR and delete a field that is now the one part of the
bundle a fixed-selector probe structurally cannot supply.

**Unchanged and still load-bearing:** activation stays gated on
`LHREMOTE_CAPTURE_DIAGNOSTICS=1` at every site and on every trigger, for the
reactions modal above all — its bundle carries engager names, profile slugs and
headlines, i.e. personal data.

### 2026-09-04 — The search-results surface captures too (#870)

The § 2026-09-01 Amendment above generalized capture from *timeout* to
*failure* and enumerated the sites that do it. The **search-results** surface
was not among them, and until #870 it captured **nothing** at any of its
failure sites — while every other place this codebase can fail to read a
LinkedIn page wrote a bundle. ADR-008 § 2026-09-02 Amendment recorded that gap
as *"deliberately not done here, so a reader does not infer it"*; this closes
it. (That date carries two ADR-008 amendments; this is the search-results one,
#841.)

**Why this surface warrants it more than the others, not less.** It has the
least offline evidence behind it: its `legacy` adapter is *reconstructed* from
a 2026-03-26 selector study and the diff of commit `24052dd` rather than
probed, and no live probe of a legacy or a zero-result search page exists. A
live capture is therefore the only route by which a field failure yields a page
to read at all. It is also the surface where the error alone is least
diagnostic — see the `variantDetection` note below.

**The two trigger classes already defined, across three call sites:**

| Trigger | Stem | `console.warn` tag |
|---|---|---|
| readiness timeout, search results | `wait-for-search-results` | `[waitForSearchResults]` |
| extraction failure, search results | `search-results-extraction-failure` | `[searchResultsExtraction]` |

- `waitForSearchResults` captures when its polling deadline expires. The
  capture fires **ahead of** the post-deadline classification rather than once
  per branch, so all three outcomes — `DOMVariantUnsupportedError`,
  `DOMVariantAmbiguousError`, `ExtractionTimeoutError` — produce the same
  artifact, and the one detect probe already read for the error's `cause` is
  the one recorded in the bundle. They cannot disagree about what was on the
  page.
- `searchPosts` captures at its **container tier** — the scroll-loop scrape
  coming back `null` (no adapter read the page, or the claiming one enumerated
  no cards) or reporting two claimants.
- `searchPosts` captures at its **cardinal tier** — the `ExtractionFailedError`
  corroboration raises when `postCardCount > 0` contradicts an empty `posts`.

The last two are the same pair `getPost` covers on post detail, and the same
pair `getPostEngagers` covers through its own `unreadableModalError`. Neither
reaches a deadline: readiness went green in milliseconds, an adapter claimed
the page — and only then did the read fail. That is precisely why a
timeout-gated capture could not see either, and why this surface's dominant
suspected failure path produced no artifact at all.

An earlier draft of this amendment scoped the container tier OUT and justified
it by claiming `getPostEngagers` drew that line. It does not — `get-post-engagers.ts`'s
`unreadableModalError` captures before raising either variant error — so the
scope went with the justification rather than surviving it. Recorded because a
reader meeting only the narrower shape would have no way to tell a deliberate
boundary from an oversight.

**Bundle fields, and the one that reads differently here.** The bundle carries
`trigger` and `variantDetection` exactly as its two siblings do, plus two
fields of its own:

- a **card funnel** — a `scopeMatchCounts` map and a deduplicated
  `candidateCardCount`, then the three cumulative counts
  `cardsClearingHeightFloor` → `cardsWithAuthorLink` → `cardsWithMenuButton`.
  Each of those three is the population that survived every filter above it, in
  the card loop's own order, so the step where the number collapses names the
  layer that broke. The first two are not survivor counts and are not part of
  that chain: `candidateCardCount` is the union the funnel enumerates from, and
  can exceed what any single adapter would have enumerated. It is *generated from the adapter
  registry* by `buildSearchResultsCardFunnelSource`, next to the extraction
  source whose filters it mirrors, rather than hand-written at the capture
  site: a second copy of a card selector drifting would leave the funnel
  confidently measuring a layer the loop no longer applies, and a diagnostic
  that lies is worse than one that is absent. It enumerates the **union** of
  every adapter's scopes, deduplicated by element identity — deliberately
  wider than any single adapter's binding, because this is the artifact read
  precisely when no adapter could claim the page.
- a **`cardinals`** block — the scrape's self-reported `variant` beside
  `postCardCount` and `extractedCount`. This is what makes an
  `ExtractionFailedError` on this surface self-explaining rather than merely
  typed. `null` on the readiness-timeout trigger, where no scrape ran; the
  `trigger` field narrows what a `null` means — under `readiness-timeout` no
  scrape was attempted, under `extraction-failure` the scrape itself was
  unreadable — so the field is always present rather than sometimes absent.

**`variantDetection` has an extra branch on this surface, and the bundle
cannot close it.** Everywhere else, *nothing matched* means LinkedIn served a
dialect nobody registered. Here it means that **or** that the search
legitimately matched nothing — a result-less page renders no cards, so no
`detect` anchor can match either (ADR-008 § 2026-09-02 Amendment, #841). The two are
indistinguishable from the DOM with what is measured today, and the funnel
cannot separate them: both produce an all-zero reading. What separates them is
`bodyTextSnippet` and the screenshot beside it — a result-less search page says
so in words a reader can read.

That is deliberately **not** a probe. A `hasNoResultsBlock`-style selector
would put an unmeasured anchor into the one artifact an operator consults when
they have no other evidence, and a confident wrong reading there is worse than
none — the same refusal `zeroMatchCause` makes one layer up, on the same
grounds ADR-008 § Decision 3 gives for removing the always-true `<main>`
fallback. Settling this properly needs a live probe of a zero-result search
page, which remains open.

**Unchanged, and load-bearing:** activation stays gated on
`LHREMOTE_CAPTURE_DIAGNOSTICS=1` at both new sites. A search-results bundle
carries author names, profile slugs, headlines and post bodies — third
parties' personal data — so CLI and MCP remain default-off. The per-invocation
`mkdtemp` directory, the `0o700`/`0o600` modes, the cancellation cap, and the
rule that a capture-side failure never masks the caller's error all carry over
untouched. On the extraction site the detect probe is additionally skipped
outright when capture is off: unlike `getPostEngagers`, nothing on that path
needs it for the *error* — the settled scrape already reported its own dialect
— so its sole consumer is the bundle.

## Related

- Code: `packages/core/src/operations/navigate-to-profile.ts`
- Branch: `fix/navigate-to-profile-diagnostics` (initial selector
  decision); `fix/unfollow-profile-company-urls` (2026-04-29 amendment)
- Issues: #757 (company-page extension); #835 (2026-09-01 amendment —
  capture on extraction failure, per-adapter detect counts in the bundle);
  #840 (2026-09-02 amendment — reactions-modal `variantDetection`); #870
  (2026-09-04 amendment — the search-results readiness and extraction sites)
