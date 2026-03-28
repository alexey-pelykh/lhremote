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
- Use Copilot review; address feedback and re-request until no actionable comments remain

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

## Infrastructure

- **Monorepo**: pnpm workspace with 4 packages: `core`, `mcp`, `cli`, `lhremote`
- **Toolchain**: pnpm 9.15.4, Node 24, Turbo (cached via `.turbo/`)
- **CI**: GitHub Actions (`ci.yml`) — `build`, `lint`, `test` on ubuntu/macos/windows matrix
  - GH Pages docs built via pandoc on every CI run, published on push to main
  - Composite setup action: `.github/actions/setup/action.yml` (pnpm + node + playwright chromium + turbo cache)
  - Concurrency: cancel-in-progress for PRs, not for main
- **Release**: GitHub Actions (`release.yml`) — triggered by GitHub Release publish
  - Validates (build+lint+test), stamps version from tag, publishes to npm (OIDC trusted publishing)
  - Concurrency group `release`, never cancels in-progress
- **claude-plugin**: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `server.json` versions must match the npm package version (set by the release tag) and be bumped together on each release
  - The release workflow does **not** auto-bump these files — after each release, open a PR to update their `"version"` fields to match the new tag
  - All three files must always show the same version string

## Task Tracking

- **Issues**: https://github.com/alexey-pelykh/lhremote/issues
- **Milestones**: used for grouping related issues into campaigns/phases
- **Labels**: default GitHub set (bug, enhancement, documentation, etc.)
- No GitHub Projects
