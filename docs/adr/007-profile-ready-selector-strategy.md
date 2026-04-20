# ADR-007: Profile Page Readiness Selector Strategy

## Status

Accepted (2026-04-19)

## Context

`navigateToProfile` (`packages/core/src/operations/navigate-to-profile.ts`) synchronizes a just-issued CDP `Page.navigate` against the target profile's DOM being ready for subsequent interaction. `client.navigate()` is fire-and-forget at the CDP layer — it sends `Page.navigate` and returns immediately without awaiting load events — so a DOM-level selector wait is the only synchronization point before downstream detection queries run (`PROFILE_FOLLOWING_BUTTON_SELECTOR`, `PROFILE_MORE_BUTTON_SELECTOR`, etc.).

The original implementation used `main h1` with a 30-second timeout. On 2026-04-19, both profile-page E2E tests (`unfollow-profile`, `hide-feed-author-profile`) began failing with identical `Timed out waiting for element "main h1" after 30000ms` errors. Diagnostic instrumentation confirmed the profile page was otherwise healthy (correct URL, correct `document.title`, `<main>` present, Message/Follow buttons rendered) — LinkedIn simply no longer wraps the profile name in an `<h1>` element.

This is not an isolated failure. Historical evidence from `research/linkedin/feed-dom-selectors-20260326.md` shows LinkedIn periodically removes semantic markers from its feed and profile DOM. Any selector strategy rooted in DOM headings or CSS class names has an expected half-life on the order of weeks-to-months.

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

**Diagnostic instrumentation is first-class but opt-in**: `navigateToProfile` can capture `{ href, title, DOM probes, screenshot }` on `CDPTimeoutError`. Activation is gated on `LHREMOTE_CAPTURE_DIAGNOSTICS=1`; artifacts land under `${os.tmpdir()}/lhremote-diagnostics/` as `navigate-to-profile-{timestamp}-{publicId}.{json,png}`. E2E tests set this env var via `vitest.e2e.config.ts`, so every test run produces diagnostics without code changes. Production callers (CLI, MCP server) remain default-off — screenshots of LinkedIn profile pages contain personal data and must not be written silently. Future LinkedIn DOM changes are still classifiable (re-run with the env var set) without code changes.

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

## Related

- Research: `../research/linkedin/profile-page-dom-20260419.md`
- Code: `packages/core/src/operations/navigate-to-profile.ts`
- Branch: `fix/navigate-to-profile-diagnostics`
