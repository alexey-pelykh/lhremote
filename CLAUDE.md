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
- Chromium is installed in CI via `npx playwright-core install chromium --with-deps`.
- E2E tests live in `packages/e2e/src/` and are **not** run in CI. Always run `pnpm test:e2e` locally before submitting PRs that add or modify E2E tests.
- Run a single E2E file: `pnpm --filter @lhremote/e2e test:e2e:file <pattern>` (e.g., `list-accounts`). Do **not** use `--` before the pattern — pnpm forwards it literally and vitest ignores args after `--` for file filtering.
- E2E tests must assert preconditions explicitly — never silently skip via `if (accounts.length > 0)`. Use `resolveAccountId(port)` from `@lhremote/core/testing` which throws if no accounts exist.
- Shared E2E helpers (`resolveAccountId`, `forceStopInstance`, `assertDefined`, `getE2EPersonId`) are exported from `@lhremote/core/testing` — do not duplicate them locally in test files.
- `navigateToProfile` can capture timeout diagnostics (URL, `document.title`, DOM probes, full-page screenshot) under `${os.tmpdir()}/lhremote-diagnostics/` on `CDPTimeoutError`. Activation is gated on `LHREMOTE_CAPTURE_DIAGNOSTICS=1`; E2E runs set it via `vitest.e2e.config.ts`, CLI/MCP are default-off (see ADR-007). Inspect these artifacts before changing profile selectors.

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

## Task Tracking

- **Issues**: https://github.com/alexey-pelykh/lhremote/issues
- **Milestones**: used for grouping related issues into campaigns/phases
- **Labels**: default GitHub set (bug, enhancement, documentation, etc.)
- No GitHub Projects
