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
- Unit tests **must not** depend on declaration order. `vi.clearAllMocks()` drops call records but keeps mock IMPLEMENTATIONS, so a `mockResolvedValue` / `mockRejectedValue` set in one test stays installed for every test after it; and `vi.restoreAllMocks()` undoes only `vi.spyOn` spies, so it clears neither the records nor the implementations of a `vi.mock()` module mock. Flag a suite whose assertion holds only because of where a test sits in the file — `expect(someMock).not.toHaveBeenCalled()` is the sharpest tell, since it reads records no hook is clearing. Use `vi.resetAllMocks()` and re-establish the baseline in `beforeEach` (`packages/core/src/services/instance-context.test.ts`, `packages/core/src/operations/navigate-away.test.ts`). Flag a reset baseline that defaults to the branch an assertion is testing: a mock reset to `undefined` still resolves when awaited, so the default must send an unconfigured test down the path that fails loudly, not the one that passes.
- A `vi.stubGlobal` called **inside a test or a hook must** be released by `vi.unstubAllGlobals()` in `afterEach`. Neither reset nor restore undoes a stub, so it otherwise outlives the test that set it and the next test inherits it. When the stubbed global is `fetch` or `WebSocket` the thing displaced is a Tier-1 guard, which fails open and silently once gone: a later test that would have been failed loudly instead receives whatever the leftover stub returns. A stub installed once at **module scope**, deliberately holding for the whole file, is the exception and needs no `afterEach` — `packages/core/src/cdp/client.test.ts` replaces `WebSocket` that way on purpose. Flag such a file-wide stub only to confirm it names which guard it is standing in for.
- `vi.useFakeTimers()` **must** be released in a `finally` or an `afterEach`, never by a trailing `vi.useRealTimers()` at the end of a test body — a failing assertion otherwise leaves the fake clock installed for every test that follows, and `shouldAdvanceTime` keeps most of them alive, so the cascade is intermittent and lands on the wrong test. Flag `vi.spyOn` on a global that fake timers also replace (`setTimeout`, `Date`) taken while the clock is installed: the spy captures the clock's function as its "original" and vitest's registry re-applies it after `useRealTimers()` has restored the native one. Replace the global by plain assignment restored in a `finally`, carrying its own property descriptors across.
- E2E tests **must** assert preconditions explicitly — flag patterns like `if (accounts.length > 0)` that silently skip when preconditions fail. Use `resolveAccountId(port)` which throws.
- Shared helpers (`resolveAccountId`, `forceStopInstance`, `assertDefined`, `getE2EPersonId`) are exported from `@lhremote/core/testing` — flag local duplicates.
- Every `describe` / `it` block must contain at least one Vitest assertion (e.g. `expect(value).toBe(...)`, `expect(fn).toThrow(...)`, or `await expect(promise).rejects.toThrow(...)`). Flag empty or no-op tests.
- CDP mocks should reuse established patterns (see `packages/core/src/cdp/client.test.ts`) — flag new hand-rolled mock WebSockets that diverge from the existing approach.
