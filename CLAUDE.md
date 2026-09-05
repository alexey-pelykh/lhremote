# lhremote — Claude Instructions

> Automation toolkit for LinkedHelper.com

## Conventions

### Naming

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `campaign-format.ts` |
| Classes | PascalCase | `CampaignService` |
| Functions | camelCase | `checkStatus()` |
| Constants | UPPER_SNAKE | `DEFAULT_LAUNCHER_PORT` |

### Commits

Format: `(type) scope: description`

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

Example: `(feat) mcp: add campaign-create tool`

Do **not** add issue numbers (e.g. `(#12)`) to commit messages. GitHub links PRs to issues via `Closes #N` in the PR body, not in commits.

### PR Workflow

- Never push directly to `main` — always create a feature/fix branch, even for small changes (`enforce_admins` is enabled)
- Run `pnpm lint` before pushing
- PR body must include `Closes #N` to link the related issue

#### Copilot Review Cycle

After pushing a PR, follow this cycle until Copilot has no actionable comments:

1. **Request** Copilot review (if not auto-requested by ruleset)
2. **Wait** for Copilot to post its review
3. **Address** every Copilot comment systematically
4. **Push** fixes
5. **Re-request** Copilot review
6. **Repeat** from step 2 until Copilot returns no actionable comments

Do **not** dismiss or ignore Copilot feedback. Every comment must be explicitly addressed (fixed, rejected with rationale, or deferred with tracking).

## Testing

| Tier | Scope | Environment | Dependency |
|------|-------|-------------|------------|
| 1 — Unit | Mocked CDP protocol, error handling, request correlation | CI (`vitest run`) | None |
| 2 — Integration | Real headless Chromium via `playwright-core` | CI (`vitest run`) | Chromium binary (installed by Playwright) |
| 3 — E2E | Full LinkedHelper app, real LinkedIn interactions | Local only | LinkedHelper (paid app) |

- Tier 1 and 2 run together via `pnpm test` — no separate commands needed.
- Integration tests use `*.integration.test.ts` suffix.
- Test helper `packages/core/src/cdp/testing/launch-chromium.ts` manages Chromium lifecycle.
- Test helper `packages/core/src/cdp/testing/install-document.ts` installs fixture markup into that page. Every Tier-2 install goes through it and none calls `Page.setDocumentContent` directly: it does not return until the installed document has been observed through the same `client.evaluate` path the assertions use, and without that gate an evaluation landing on a document that is not the one just installed counts 0 for every selector rather than throwing — a clean, wrong number (#888).
- Chromium is installed in CI via `npx playwright-core install chromium --with-deps`.
- E2E tests live in `packages/e2e/src/` and are **not** run in CI. Always run `pnpm test:e2e` locally before submitting PRs that add or modify E2E tests.
- Run a single E2E file: `pnpm --filter @lhremote/e2e test:e2e:file <pattern>` (e.g., `list-accounts`). Do **not** use `--` before the pattern — pnpm forwards it literally and vitest ignores args after `--` for file filtering.
- E2E tests must assert preconditions explicitly — never silently skip via `if (accounts.length > 0)`. Use `resolveAccountId(port)` from `@lhremote/core/testing` which throws if no accounts exist.
- Shared E2E helpers (`resolveAccountId`, `forceStopInstance`, `assertDefined`, `getE2EPersonId`) are exported from `@lhremote/core/testing` — do not duplicate them locally in test files.
- Failure diagnostics (URL, `document.title`, DOM probes, full-page screenshot) are captured into a per-invocation `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/` directory (created via `mkdtemp` for TOCTOU-safe atomic creation — see ADR-007 § 2026-05-05 Amendment). **Capture is not timeout-only**: it fires on readiness timeouts AND on extraction failures, which never reach a deadline. Trigger condition per site: `navigateToProfile` and `navigateToCompany` each capture on `CDPTimeoutError` from their underlying `waitForElement`, under their own artifact stems; `waitForPostLoad` captures when its own polling deadline expires, then throws a typed error classified from a post-deadline variant probe — `DOMVariantUnsupportedError` when no post-detail adapter claims the page, `DOMVariantAmbiguousError` when more than one does, `ExtractionTimeoutError` otherwise; `getPost` captures on the `DOMVariantUnsupportedError` / `DOMVariantAmbiguousError` its post-detail scrape raises and on the `ExtractionFailedError` raised when a scrape contradicts a cardinal the same page rendered (`commentCount` / `totalReactions` > 0 next to an empty list); `getPostStats` captures on those same two variant errors, raised by the same generated script on the same page — it shares `getPost`'s capture helper rather than keeping a second copy of it, and has no cardinal branch because it reads no list to contradict one; `waitForReactionsModal` captures when its own polling deadline expires and classifies the same three ways against the reactions-modal adapters (`ExtractionTimeoutError` naming the reactions modal as its subject); `getPostEngagers` captures on both classes — the `DOMVariantUnsupportedError` / `DOMVariantAmbiguousError` its modal scrape raises when no adapter resolves the modal root, and the `ExtractionFailedError` above; `waitForSearchResults` captures when its own polling deadline expires, ahead of the classification rather than per-branch, so all three of its outcomes get an artifact; `searchPosts` captures on both classes, like the two operations above it — the `DOMVariantUnsupportedError` / `DOMVariantAmbiguousError` its scroll-loop scrape raises when no adapter reads the page or two claim it, and the `ExtractionFailedError` raised when `postCardCount` > 0 contradicts an empty `posts`. The post-detail, reactions-modal and search-results artifacts name their own trigger, in the filename stem and in a `trigger` field inside the bundle (the `navigateTo*` artifacts are timeout-only and carry neither). The post-detail, reactions-modal and search-results bundles also carry `variantDetection` — `matched` plus per-registered-adapter detect counts, read together: nothing matched means LinkedIn served a dialect we don't know (register an adapter), two or more means a hybrid page (tighten the detect anchors), exactly one means our adapter matched and that field's selectors went stale. `null` there means the probe yielded no usable reading, which is **not** the claim that no adapter matched. **On search-results that reading has one more branch**: nothing matched means an unknown dialect OR a search that legitimately matched nothing, which no probe in the bundle can separate — the body-text snippet and the screenshot are what settle it, and no "empty results" selector is probed because none has been measured on either dialect. That bundle additionally carries a cumulative card funnel (`candidateCardCount` → `cardsClearingHeightFloor` → `cardsWithAuthorLink` → `cardsWithMenuButton`, generated from the adapter registry so it mirrors the card loop's own filters), where the number collapses being the layer that broke, plus a `cardinals` block pairing `postCardCount` with the extraction it contradicts — `null` there means no scrape settled, which under `readiness-timeout` means none was attempted and under `extraction-failure` means the scrape itself was unreadable. **The post-detail bundle carries a registry-derived field of its own, `variantAnchors`**: one reading per registered post-detail adapter, keyed by that adapter's `variant`, each giving the match count for its `ready` anchor and a per-selector map for its `scopes` and `counts` candidates — generated by `buildPostDetailAnchorProbeSource` and spliced into the capture's single existing page read, so a dialect renamed in the registry cannot keep being reported under its old name. Read it *with* `variantDetection`, which answers a different question: `variantDetection` says which dialect the page is, `variantAnchors` says how far that dialect's own anchors got, and the fixed-selector probes beside them say how far the page got in markers no dialect owns — an exactly-one `variantDetection` next to an all-zero `variantAnchors` entry for that same dialect is a claimed-but-unhydrated page, which neither field states alone. `detect` is deliberately absent from `variantAnchors`: it is read on the classification path and reaches the bundle as `variantDetection`, so giving it a second home would report one anchor **role** twice. That is about the role, not the selector — a dialect may use one string in two roles, and `legacy`'s `detect` **is** its `scopes[0]`, so that selector is read once per probe and the two counts can differ because the reads are seconds apart on a hydrating page; read a disagreement as evidence about the page, and check a `ready` or `counts` anchor before concluding a dialect claimed the page without hydrating. It replaced the hand-maintained `hasPostDetailContainer` boolean and is **wider** than it — the same selector is still read, as a count under `sdui`, alongside the SDUI screen wrapper, both dialects' `ready` anchors and the legacy `.social-details-social-counts` row, none of which was probed before. The selector constants `wait-for-post-load.ts` still hand-maintains are markers **no adapter anchors on** and must stay: a failed read wants a which-of-these-is-missing picture wider than any single adapter's binding. See ADR-007 § 2026-09-01 Amendment, its two § 2026-09-04 extensions (#870, the search-results sites; #853, the post-detail `variantAnchors`) and its § 2026-09-05 Amendment (#890, `getPostStats` — the last site that captured nothing), and ADR-008 § 2026-09-02 Amendment (#840) for the reactions-modal binding that made its `variantDetection` field readable at all. Activation at every site is gated on `LHREMOTE_CAPTURE_DIAGNOSTICS=1`; E2E runs set it via `vitest.e2e.config.ts`, CLI/MCP are default-off — the artifacts contain page content, i.e. personal data. The trailing `console.warn` line emitted by the helper reports the actual artifact path. Inspect these artifacts before changing profile, post-detail, reactions-modal or search-results selectors.

## Infrastructure

- **Monorepo**: pnpm workspace with 4 packages: `core`, `mcp`, `cli`, `lhremote`
- **Toolchain**: pnpm 9.15.4, Node 24, Turbo (cached via `.turbo/`)
- **CI**: GitHub Actions (`ci.yml`) — `build`, `lint`, `test` on ubuntu/macos/windows matrix
  - GH Pages docs (README + rate-limiting guide) built via pandoc on every CI run, published on push to main
  - Composite setup action: `.github/actions/setup/action.yml` (pnpm + node + playwright chromium + turbo cache)
  - Concurrency: cancel-in-progress for PRs, not for main
- **Release**: GitHub Actions (`release.yml`) — triggered by GitHub Release publish
  - Validates (build+lint+test), stamps version from tag, publishes to npm (OIDC trusted publishing)
  - Concurrency group `release`, never cancels in-progress
- **claude-plugin**: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `server.json` versions must match the npm package version (set by the release tag) and be bumped together on each release
  - The release workflow does **not** auto-bump these files — after each release, open a PR to update their `"version"` fields to match the new tag
  - All three files must always show the same version string

## Design Decisions

Architecture Decision Records live in `docs/adr/` and explain *why* the codebase is structured the way it is:

| ADR | Decision | Code Area |
|-----|----------|-----------|
| [001](docs/adr/001-monorepo-package-structure.md) | Monorepo package structure | `packages/` (core, mcp, cli, lhremote) |
| [002](docs/adr/002-cdp-automation-via-electron.md) | CDP-based automation via Electron | `packages/core/src/cdp/` |
| [003](docs/adr/003-sqlite-direct-file-access.md) | SQLite direct file access | `packages/core/src/db/` |
| [004](docs/adr/004-three-tier-testing-strategy.md) | Three-tier testing strategy | `*.test.ts`, `*.integration.test.ts`, `packages/e2e/` |
| [005](docs/adr/005-error-hierarchy-design.md) | Error hierarchy design | `packages/core/src/*/errors.ts` |
| [006](docs/adr/006-operations-layer.md) | Operations layer | `packages/core/src/operations/` |
| [007](docs/adr/007-profile-ready-selector-strategy.md) | Profile page readiness selector strategy | `packages/core/src/operations/navigate-to-profile.ts` |
| [008](docs/adr/008-readiness-binding-and-empty-vs-error-contract.md) | Readiness binding and the empty-vs-error contract (post-detail; search-results and reactions-modal per the § 2026-09-02 Amendments) | `packages/core/src/linkedin/dom-variant.ts`, `packages/core/src/linkedin/corroboration.ts`, `packages/core/src/cdp/wait-for-post-load.ts`, `packages/core/src/cdp/wait-for-reactions-modal.ts`, `packages/core/src/operations/get-post.ts`, `packages/core/src/operations/get-post-engagers.ts`, `packages/core/src/operations/get-post-stats.ts`, `packages/core/src/operations/search-posts.ts`, `packages/core/src/services/errors.ts` |

## Task Tracking

- **Issues**: https://github.com/alexey-pelykh/lhremote/issues
- **Milestones**: used for grouping related issues into campaigns/phases
- **Labels**: default GitHub set (bug, enhancement, documentation, etc.)
- No GitHub Projects
