---
applyTo: "**/*.test.ts,**/*.integration.test.ts"
---

# Test Review Instructions

## Three-Tier Testing Model

| Tier | Suffix | Runs In | Uses |
|------|--------|---------|------|
| 1 — Unit | `*.test.ts` | CI | Mocked CDP, no external deps — enforced: the root `vitest.setup.ts` fails any unit test that reaches the live network |
| 2 — Integration | `*.integration.test.ts` | CI | Real headless Chromium via playwright-core |
| 3 — E2E | `*.e2e.test.ts` in `packages/e2e/` | Local only | Full LinkedHelper app |

## Rules

- Integration tests **must** use the `*.integration.test.ts` suffix. Flag any test using real Chromium without this suffix.
- Unit tests **must not** reach the live network. The root `vitest.setup.ts` blocks `fetch` and `WebSocket` in `*.test.ts` and fails the test naming the call. Flag any unit test renamed to `*.integration.test.ts` purely to escape the guard — that suffix is the exemption, so it is the one direction the tooling cannot catch.
- E2E tests **must** assert preconditions explicitly — flag patterns like `if (accounts.length > 0)` that silently skip when preconditions fail. Use `resolveAccountId(port)` which throws.
- Shared helpers (`resolveAccountId`, `forceStopInstance`, `assertDefined`, `getE2EPersonId`) are exported from `@lhremote/core/testing` — flag local duplicates.
- Every `describe` / `it` block must contain at least one Vitest assertion (e.g. `expect(value).toBe(...)`, `expect(fn).toThrow(...)`, or `await expect(promise).rejects.toThrow(...)`). Flag empty or no-op tests.
- CDP mocks should reuse established patterns (see `packages/core/src/cdp/client.test.ts`) — flag new hand-rolled mock WebSockets that diverge from the existing approach.
