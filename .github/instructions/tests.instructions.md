---
applyTo: "**/*.test.ts,**/*.integration.test.ts"
---

# Test Review Instructions

## Three-Tier Testing Model

| Tier | Suffix | Runs In | Uses |
|------|--------|---------|------|
| 1 — Unit | `*.test.ts` | CI | Mocked CDP, no external deps — enforced on two axes by the root `vitest.setup.ts`: it fails any unit test that reaches the live network, and it pins `LHREMOTE_CAPTURE_DIAGNOSTICS` off so no unit test writes a real failure-diagnostic bundle |
| 2 — Integration | `*.integration.test.ts` | CI | Real headless Chromium via playwright-core |
| 3 — E2E | `*.e2e.test.ts` in `packages/e2e/` | Local only | Full LinkedHelper app |

## Rules

- Integration tests **must** use the `*.integration.test.ts` suffix. Flag any test using real Chromium without this suffix.
- Unit tests **must not** reach the live network. The root `vitest.setup.ts` blocks `fetch` and `WebSocket` in `*.test.ts` and fails the test naming the call.
- Unit tests **must not** write failure-diagnostic bundles. The same `vitest.setup.ts` pins `LHREMOTE_CAPTURE_DIAGNOSTICS` off for `*.test.ts` — deleting it at setup-file evaluation time and re-pinning before every test — so a unit run cannot take the real `mkdtemp` + `writeFile` path just because the launching shell exported the variable. A deliberate opt-in inside a test still wins.
- Flag any unit test renamed to `*.integration.test.ts` purely to escape those guards — that suffix is the exemption for both, so it is the one direction the tooling cannot catch, and it now switches off two guards rather than one: the file runs with the network open **and** the capture unpinned.
- Flag any Tier-1 suite that drives an operation into a failure-diagnostic capture (`waitForPostLoad`, `waitForReactionsModal`, `waitForSearchResults`, `navigateToProfile` / `navigateToCompany`, `getPost`, `getPostStats`, `getPostEngagers`, `searchPosts`) **without mocking `node:fs/promises`**. This is the residual the pin cannot close by construction: the pin fixes the ambient default, but a suite that sets `LHREMOTE_CAPTURE_DIAGNOSTICS` itself — as every capture-path suite deliberately does — writes real bundles holding LinkedIn page content unless the filesystem is doubled. Same defect class as the one the pin closed, arriving by a different route.
- E2E tests **must** assert preconditions explicitly — flag patterns like `if (accounts.length > 0)` that silently skip when preconditions fail. Use `resolveAccountId(port)` which throws.
- Shared helpers (`resolveAccountId`, `forceStopInstance`, `assertDefined`, `getE2EPersonId`) are exported from `@lhremote/core/testing` — flag local duplicates.
- Every `describe` / `it` block must contain at least one Vitest assertion (e.g. `expect(value).toBe(...)`, `expect(fn).toThrow(...)`, or `await expect(promise).rejects.toThrow(...)`). Flag empty or no-op tests.
- CDP mocks should reuse established patterns (see `packages/core/src/cdp/client.test.ts`) — flag new hand-rolled mock WebSockets that diverge from the existing approach.
