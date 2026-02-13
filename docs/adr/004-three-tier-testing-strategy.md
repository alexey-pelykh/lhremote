# ADR-004: Three-Tier Testing Strategy

## Status

Accepted

## Context

lhremote interacts with three external systems that create testing challenges:

1. **Chrome DevTools Protocol** — WebSocket-based communication with Electron processes
2. **SQLite databases** — direct file access to LinkedHelper's data files
3. **LinkedHelper application** — a licensed desktop application that manages LinkedIn accounts

Each system has different availability: CDP can be exercised against any Chromium process, SQLite databases can be created from fixtures, but the full LinkedHelper application requires a paid license and an active LinkedIn session.

CI needs to run reliably without LinkedHelper installed. Local development needs to validate end-to-end behavior with the real application.

## Decision

Organize tests into three tiers with increasing integration scope and decreasing CI availability:

| Tier | Scope | Runner | Environment | External dependencies |
|------|-------|--------|-------------|----------------------|
| **1 — Unit** | Mocked CDP protocol, mocked database, pure logic | `vitest run` | CI + local | None |
| **2 — Integration** | Real headless Chromium, real SQLite fixtures | `vitest run` | CI + local | Chromium binary (via playwright-core) |
| **3 — E2E** | Full LinkedHelper app, real LinkedIn interactions | `vitest run --config vitest.e2e.config.ts` | Local only | LinkedHelper (licensed), active LinkedIn session |

**Key design choices:**

1. **Tiers 1 and 2 share the same test runner invocation** (`pnpm test`) — integration tests are distinguished by the `*.integration.test.ts` suffix but run alongside unit tests. No separate commands needed.

2. **Tier 3 uses a separate vitest config** (`vitest.e2e.config.ts`) that includes only `*.e2e.test.ts` files and disables file parallelism (`fileParallelism: false`) to avoid CDP port conflicts.

3. **Chromium management via `playwright-core`** — integration tests use a shared test helper (`launch-chromium.ts`) that launches a headless Chromium instance. CI installs Chromium via `npx playwright-core install chromium --with-deps`.

4. **SQLite test fixtures** — integration tests for database repositories use `createFixture()` / `openFixture()` helpers that create temporary database files with known data, avoiding dependency on real LinkedHelper databases.

5. **Fake timers for time-dependent logic** — unit tests for polling, timeouts, and reconnection use `vi.useFakeTimers()` with explicit timer advancement rather than real-time waits.

## Alternatives Considered

### Two tiers (unit + E2E only)

Skip the integration tier. Unit tests with mocks verify logic; E2E tests verify real behavior. The gap is significant — mocked CDP tests cannot catch WebSocket protocol issues, and mocked database tests cannot catch SQL query errors against real SQLite. The integration tier fills this gap cheaply (Chromium is free, fixtures are deterministic).

### Docker-based LinkedHelper for CI

Run LinkedHelper in a Docker container to enable E2E tests in CI. LinkedHelper is a licensed Electron desktop application that requires a display server and a paid license. Containerizing it would be fragile, require license management in CI, and would not reliably support LinkedIn session state.

### Record/replay for CDP interactions

Capture real CDP conversations and replay them in tests. This approach is brittle — small changes in message ordering or timing break replays. The integration tier with real Chromium provides the same confidence without the maintenance burden of recorded fixtures.

### Separate test directories

Place tests in a top-level `test/` or `tests/` directory rather than co-located with source files. Co-location (`src/cdp/client.test.ts` next to `src/cdp/client.ts`) makes it easier to find tests for a given module and keeps related code together. The file suffix convention (`*.test.ts`, `*.integration.test.ts`, `*.e2e.test.ts`) is sufficient to distinguish tiers.

## Consequences

**Positive:**

- CI runs Tiers 1 + 2 reliably with no external dependencies beyond Chromium
- Integration tests catch real protocol and query issues that mocked tests miss
- E2E tests validate the full automation flow when needed, without blocking CI
- Co-located test files make it easy to find and maintain tests alongside the code they verify
- Shared vitest runner means a single `pnpm test` command covers both unit and integration tiers

**Negative:**

- E2E tests require a specific machine setup (LinkedHelper installed and licensed, LinkedIn session active, test profile configured)
- Integration tests add CI time for Chromium installation and process lifecycle management
- The tier boundary is enforced by file naming convention, not by tooling — a misnamed file could run in the wrong tier
- No automated E2E coverage in CI means regressions in LinkedHelper interaction are caught only during local testing

**Neutral:**

- The `playwright-core` dependency is devDependencies-only and used solely for Chromium lifecycle management in tests, not for browser automation features
