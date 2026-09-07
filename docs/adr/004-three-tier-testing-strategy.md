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

## Amendments

### 2026-09-04 — A second shared Tier-2 helper: the install gate

Decision 3 named `launch-chromium.ts` as *the* shared Tier-2 helper, which was
true while launching the browser was the only thing every integration suite
did. Installing markup into the launched page became the second — four suites
had each written the same `Page.setDocumentContent` call — and the duplication
was not merely repetitive: it was defective in a way no single site could see.
An evaluation resolving against a document that is not the one just installed
answers `0` for every selector rather than throwing, so on the windows runner a
selector count came back clean and wrong roughly once per full run across all
four install sites, on a different test each time (issue #888).

`packages/core/src/cdp/testing/install-document.ts` is therefore the second
shared helper, and the boundary it draws is worth stating as a rule rather than
as a convenience: **no Tier-2 suite calls `Page.setDocumentContent` directly.**
The helper appends a marker carrying a token unique to that install and polls,
through the ordinary no-`contextId` `client.evaluate` the assertions themselves
use, until the marker is observed — so it cannot return before the installed
document is queryable on the path the next assertion will take. A suite that
installs markup by hand loses that guarantee silently, which is why the rule is
recorded here alongside the helper rather than left to the helper's own doc
comment.

Detecting the fault is not the whole job. The gate's first windows run polled
cleanly for 3.1 seconds and never saw its marker — the document stays
unobservable persistently on that runner, not for a few milliseconds — which
converts a silent wrong answer into a red suite and no further. So a failed gate
navigates the frame to `about:blank` and re-drives the whole install with a
fresh token, up to three times. Whether the navigation is what recovers is a
prediction rather than an established mechanism, so the failure carries a probe
of the page (`documentLength`, `readyState`, `sentinels`) and names every
attempt, making the next occurrence decidable from its log.

That retry has a consequence for callers, and it is the second rule this
amendment records: **a suite that installs documents declares
`{ timeout: INSTALL_TEST_TIMEOUT_MS }` on its `describe`**, and passes the same
constant to any hook that installs. Vitest's undeclared 5 000 ms per-test
default is shorter than the helper's own worst case, so a suite inheriting it is
aborted by the runner before the helper can print the diagnostic — the failure
mode this whole amendment exists to remove, one level up. The constant is
exported from the helper so the two move together rather than by convention.

Decision 5 is unchanged and now also governs this helper's unit tier.

### 2026-09-06 — The Tier-1 dependency column is now enforced

The Consequences list above records, under Negative, that *"the tier boundary
is enforced by file naming convention, not by tooling — a misnamed file could
run in the wrong tier."* That is no longer true of the Tier-1 row's
external-dependency column, and the way it has stopped being true is worth
stating precisely, because it is now asymmetric rather than simply fixed.

The rule the table always stated — Tier 1 depends on nothing external — was
enforced by nobody. `packages/core/src/services/instance-context.test.ts`
issued a real `fetch` to `http://127.0.0.1:9222/json/list` through an unmocked
`isCdpPort()`, so the suite passed or failed on whether LinkedHelper happened
to be listening on the developer's machine. CI never saw it: nothing answers on
9222 there, so the false branch was always taken. Two bug reports came out of
that, one of which blamed the Node major version and sent the investigation
somewhere it could not resolve.

`vitest.setup.ts` at the repo root, wired in through the root
`vitest.config.ts`, now replaces `fetch` and `WebSocket` for every `*.test.ts`
that is not `*.integration.test.ts` or `*.e2e.test.ts`. A Tier-1 test that
reaches the live network fails, and the failure names the call and its site.

Two things follow that the original bullet does not describe.

**The misnaming consequence is now one-directional.** Tier-2 work misnamed
`*.test.ts` fails loudly at its first network call. Tier-1 work misnamed
`*.integration.test.ts` still runs unguarded and silently — the suffix is the
exemption, so the direction that buys silence is the one that still costs
nothing. Nothing detects it.

**The `.integration.test.ts` suffix now carries a second meaning.** Decision 1
above defines it descriptively, by what the tier uses: real Chromium, real
SQLite fixtures. It is now also a *selector* — the thing that switches the
guard off. A file may legitimately carry the suffix because it needs the
network rather than because it drives Chromium, and
`packages/core/src/testing/tier1-network-guard.integration.test.ts` is exactly
that case: it asserts the exemption holds and uses neither Chromium nor SQLite.

The guard covers `fetch` and `WebSocket`, which are the only network primitives
this codebase uses. It does not cover `node:http`, raw sockets, or non-network
machine state such as the `ps-list` / `pid-port` process probes — those remain
convention-enforced, exactly as this bullet originally described.

Decisions 1 through 5 are otherwise unchanged. Decision 1's claim that Tiers 1
and 2 share one runner invocation is what makes a single `setupFiles` entry
able to serve both, and the guard reads the filename to tell them apart rather
than splitting the invocation.

### 2026-09-07 — The same column now also covers the diagnostic capture (#925)

The amendment above closed the network half of the Tier-1 dependency column and
stated its own limit explicitly: the guard *"does not cover `node:http`, raw
sockets, or non-network machine state such as the `ps-list` / `pid-port` process
probes."* That sentence is now narrower by one item. Machine state in general is
still convention-enforced, but one specific piece of it — the diagnostic-capture
opt-in — is enforced mechanically, and it is worth recording why that one was
promoted out of the list rather than left in it.

The failure-diagnostic captures self-gate on `LHREMOTE_CAPTURE_DIAGNOSTICS`, and
`diagnosticCaptureEnabled()` reads it *per call* rather than at module load. A
Tier-1 suite that drives an operation into a capture while mocking neither
`node:fs/promises` nor that variable therefore takes the real `mkdtemp` +
`writeFile` path whenever the launching shell exported it.
`packages/core/src/operations/get-post-engagers.test.ts` did exactly that, and
the measurement is the point: with a private `TMPDIR`, a run of that one file
under `LHREMOTE_CAPTURE_DIAGNOSTICS=1` went from zero entries to one — a real
`lhremote-diagnostics-*/reactions-modal-extraction-failure-*.json` — while
reporting 17 passed, 0 failed. A green unit run wrote LinkedIn page content to
disk. That is the same shape as the `fetch` defect one amendment up: the suite's
behaviour was a property of the shell it was launched from, and nothing failed.

It is worse in one respect, which is what settled the promotion. The network
defect made a suite's *verdict* depend on machine state; this one leaves the
verdict alone and produces a side effect — personal data on disk, in a directory
the capture is gated default-off precisely to avoid writing. A test that is
silently right is still a test nobody re-reads.

`vitest.setup.ts` now pins the variable off inside the same
`if (!isNetworkTier())` branch. Four properties of the pin are load-bearing and
none is obvious: it captures the ambient value at module scope and deletes it
*there*, because a setup file is evaluated before the test file's own module and
two suites read that variable at their module scope; it re-deletes in
`beforeEach`, bounding a test that dirties the variable to the test that did it;
it restores the ambient value in `afterAll`, including the unset case, against
the configuration where runners are shared; and it does not clobber a
deliberate opt-in, because `@vitest/runner` recurses into the parent suite
first for `beforeEach` and does not reverse `beforeEach` under the default
`sequence.hooks: "stack"` — so the setup file's hook, registered on the root
suite before the spec module is collected, runs ahead of every `describe`-level
one at any nesting depth. Both opt-in shapes in the repo therefore win: an
assignment inside an `it()` body, which is most of them, and a `describe`-level
`beforeEach`, which `wait-for-post-load.test.ts` and
`wait-for-reactions-modal.test.ts` use.

Two of those four warrant a sharper reading than "load-bearing", because their
scope is narrower than it looks. The `afterAll` restore is **inert under this
repo's configuration**: `isolate` defaults to `true` and `vitest.config.ts` does
not override it, so each file gets its own runner, stopped afterwards, whose
environment was built fresh from the parent's — the delete never reaches the
parent, and nothing can be lost across files. It is kept for `isolate: false` /
`--no-isolate`, and its own cost is a window at file teardown in which escaped
asynchronous work could still meet an open gate — narrower than the `afterEach`
restores the three per-suite guards already carry, so a stated limit rather
than a regression. And the ordering guarantee holds only for SEQUENTIAL
execution, vitest's default and what this repo runs: under `it.concurrent` /
`describe.concurrent`, siblings start together against one process-global
`process.env`, and neither the opt-in guarantee nor the bounded-leak guarantee
survives it. There are no concurrent sites today.

**The fix site is the shared setup file, not the offending suite.** Three suites
had already grown the same hand-rolled delete-and-restore guard —
`get-post.test.ts`, `get-post-stats.test.ts`, `search-posts.test.ts` — and a
fourth was about to. Those remain in place as defence in depth against the
detachment case the per-package canaries exist for, but the class is closed
centrally rather than one suite at a time.

**The pin is Tier-1 only, and that asymmetry is deliberate.** Decision 1's table
gives Tier 1 `Dependency: None` while Tier 2's dependency is the Chromium
binary, so the two rows are not making the same promise. A Tier-2 run under an
operator's own `LHREMOTE_CAPTURE_DIAGNOSTICS=1` is that operator's explicit
opt-in and the pin must not take it away. Tier 3 is untouched for a structural
reason rather than a chosen one: `vitest.e2e.config.ts` declares no `setupFiles`
at all, so nothing in `vitest.setup.ts` ever loads for E2E and its deliberate
`env: { LHREMOTE_CAPTURE_DIAGNOSTICS: "1" }` cannot be disturbed from there.

The one-directional misnaming consequence recorded above now applies to both
guards together: Tier-1 work misnamed `*.integration.test.ts` runs with the
network open *and* the capture unpinned, silently. The suffix switches off two
things now, not one.

What this does not cover is unchanged in kind and smaller by one: `node:http`,
raw sockets, the `ps-list` / `pid-port` process probes, and any route to the
filesystem other than this one variable. A suite that genuinely grades the
capture path still mocks `node:fs/promises`, which is what the
`*-diagnostics.test.ts` files do — the narrower
`*-extraction-diagnostics.test.ts` glob misses
`packages/core/src/operations/search-posts-diagnostics.test.ts`, which has more
deliberate opt-in sites than any of the ones it matches.

Both guards are graded by the same canaries, one per package, and each asserts
the guard's `globalThis` handle rather than the absence of a network call or the
absence of an environment variable. For the pin that distinction is what makes
the canary a gate at all: nobody exports `LHREMOTE_CAPTURE_DIAGNOSTICS` in CI,
so `expect(process.env.LHREMOTE_CAPTURE_DIAGNOSTICS).toBeUndefined()` passes
there whether or not the setup file ran — a check that cannot fail on the
machine it usually runs on. The handle exists only if the pin ran.

Decisions 1 through 5 are otherwise unchanged.
