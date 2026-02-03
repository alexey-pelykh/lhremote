# lhremote — Claude Instructions

> Automation toolkit for LinkedHelper.com

## Conventions

### Naming

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `cdp-client.ts` |
| Classes | PascalCase | `ProfileService` |
| Functions | camelCase | `visitProfile()` |
| Constants | UPPER_SNAKE | `DEFAULT_CDP_PORT` |

### Commits

Format: `(type) scope: description`

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

Example: `(feat) mcp: add visit-profile tool`

Reference issues: `(fix) cdp: handle reconnection (#12)`

## Testing

| Tier | Scope | Environment | Dependency |
|------|-------|-------------|------------|
| 1 — Unit | Mocked CDP protocol, error handling, request correlation | CI (`vitest run`) | None |
| 2 — Integration | Real headless Chromium via `playwright-core` | CI (`vitest run`) | Chromium binary (installed by Playwright) |
| 3 — E2E | Full LinkedHelper app, real LinkedIn interactions | Local only | LinkedHelper (paid app) |

- Tier 1 and 2 run together via `pnpm test` — no separate commands needed.
- Integration tests use `*.integration.test.ts` suffix.
- Test helper `src/cdp/testing/launch-chromium.ts` manages Chromium lifecycle.
- Chromium is installed in CI via `npx playwright-core install chromium --with-deps`.

## Task Tracking

**Issues**: https://github.com/alexey-pelykh/lhremote/issues
