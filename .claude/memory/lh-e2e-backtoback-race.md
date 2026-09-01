---
name: LH E2E back-to-back runs race on CDP port discovery
description: Running lhremote E2E tests in quick succession can fail in beforeAll with "Instance CDP port not discovered yet" — LH hasn't fully settled between runs; simple retry resolves
type: project
originSessionId: 69536507-4e39-489b-baa1-611af227cc15
volatility: moderate
last-verified: 2026-04-19
verification: empirical-walk
---
Running two lhremote E2E tests in quick succession (e.g. `unfollow-profile` then `hide-feed-author-profile`, or repeat runs of the same test) can fail with `Error: Instance CDP port not discovered yet` — thrown after `retryAsync({ retries: 10, delay: 2_000 })` in `beforeAll` exhausts. When this fires, the test case is SKIPPED, not executed.

**Why:** LinkedHelper Electron instance + SQLite state from the prior run hasn't fully torn down by the time the next test's `startInstanceWithRecovery` asks for the CDP port. Not a code bug; environment lag.

**How to apply:** When iterating on profile / feed E2E tests locally:

- Wait ~30-60 seconds between runs, or
- Simply retry once — the second invocation after a flaky `beforeAll` typically succeeds
- Do NOT treat a single `beforeAll` CDP-port failure as a code regression; always retry once before diagnosing

Observed 2026-04-19 during `fix/navigate-to-profile-diagnostics` iteration: 3rd consecutive test run after diagnostic rebuild failed; immediate retry passed cleanly.
