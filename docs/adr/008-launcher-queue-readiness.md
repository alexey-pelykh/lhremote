# ADR-008: Launcher Queue and Instance Readiness Model

## Status

Accepted (2026-06-22)

## Context

`start-instance`, `stop-instance`, `restart-instance`, and `ensure-instances` all drive the
LinkedHelper launcher CDP API. When two of these operations overlap — e.g. an agent calls
`ensure-instances` while a `restart-instance` is mid-flight — the launcher can receive
contradictory commands for the same account slot, resulting in double-starts, phantom ports, or
orphaned processes.

At the same time, `check-status` (and the `readiness` field it reports) needs a stable model of
what "a healthy instance" looks like over time, because a single CDP-port check is unreliable:

- A port that is reachable today may become unreachable for 30–90 s during a LinkedIn
  navigation; treating that as "dead" and restarting would create a second process on the same
  account.
- A port that was never reachable after `start-instance` is genuinely stuck, not transiently
  unavailable.

Two sub-problems therefore required design decisions:

1. **Serialization** — prevent concurrent launcher writes from racing.
2. **Readiness** — distinguish transient from permanent unavailability without requiring callers
   to maintain their own history.

## Decision

### Serialization: promise-chain mutex (`launcher-queue.ts`)

Write operations are serialized through a module-level promise chain:

```
_queueTail → op1 → settle-barrier1 → op2 → settle-barrier2 → …
```

Each operation:
1. Atomically swaps itself onto `_queueTail`.
2. Awaits the previous tail (waits for its predecessor to fully complete).
3. Executes the user operation.
4. Runs a best-effort *settle barrier* — a short poll that waits for the launcher
   to confirm the new state (instance connectable / launcher reachable).
5. Releases the gate unconditionally in `finally` (even on error), so a crashing
   op never deadlocks the queue.

The settle barrier is best-effort: if it times out or errors, the gate still releases and the
error is swallowed. This keeps the queue live at the cost of occasionally releasing before the
state is fully settled — callers that need certainty should use `waitForConnectable` after the
queue returns.

The barrier is bounded by `LHREMOTE_SETTLE_BARRIER_TIMEOUT_MS` (default 8 s).

**Why a promise chain over a worker/actor model?**

A worker queue (e.g. p-queue, a dedicated async iterator) would require an external dependency
or significant boilerplate, and introduces its own lifecycle concerns (start/stop, drain-on-exit).
A module-level promise chain is three lines of state, has no external dependencies, survives
across arbitrary async boundaries, and composes naturally with `withLauncherRecovery`. The
downside — no queue depth inspection, no priority, no cancel — is acceptable because launcher
operations are rare and short-lived.

### Readiness: `InstanceReadinessTracker` singleton (`instance-readiness.ts`)

The tracker maintains two maps:

| Map | Key | Value |
|-----|-----|-------|
| `seenConnectable` | PID | `true` if this PID was ever observed connectable |
| `unreachableSince` | PID | timestamp of first unreachable observation |

`tracker.update(rawProcesses)` is called by `check-status` on every status refresh and returns a
`Map<pid, InstanceReadiness>`:

| State | Condition |
|-------|-----------|
| `connectable` | CDP port is reachable right now |
| `starting` | Port not yet reachable; PID never seen connectable |
| `degraded` | Was connectable; now unreachable; within grace window |
| `stuck` | Was connectable; now unreachable; past grace window |

The grace window (`LHREMOTE_GRACE_WINDOW_MS`, default 120 s) covers the LinkedIn navigation
dead-zone and app start time.

**Why a singleton tracker?**

Each `check-status` call is stateless by design — it inspects OS processes independently. Without
cross-call state, transient unavailability would always look like a dead instance. A singleton
that accumulates PID history bridges the gap without introducing a persistent store or requiring
callers to pass history in.

**Why PIDs and not account IDs?**

An account ID maps to a logical slot; a PID maps to a concrete process. If an account is
restarted, the new PID starts in `starting` state regardless of the old PID's history — this is
intentional. Using account IDs instead would carry stale `seenConnectable` state across restarts.

### `waitForConnectable` (`instance-readiness.ts`)

Callers that need to block until an instance is ready (the settle barrier, `restart-instance`,
`ensure-instances` Phase 2) use `waitForConnectable(accountId, knownPort?, opts?)`.

Two-phase probe:
1. **Cheap path**: if `knownPort` is provided, call `isCdpPort(knownPort)` directly.
2. **Full scan**: call `scanRunningInstances()` and match by `accountId`.

Returns `{ cdpPort, pid, verified }` where `verified: false` means the deadline elapsed before
a match was found.

### Process inspection cache (`gather-raw-processes.ts`)

`gatherRawProcesses` caches its result for 1 500 ms so that rapid successive calls (e.g. within
a single `ensure-instances` loop) do not each trigger a full WMI/ps-list query. The cache is
invalidated by `invalidateProcessCache()`, which is called:

- In the queue's `finally` block after each operation.
- Before each iteration of `waitForPidExit`.

## Alternatives Considered

### Per-operation mutex (lock per account)

Would allow concurrent operations on *different* accounts. Rejected because the launcher is a
single process; even account-scoped operations (start, stop) go through the same launcher CDP
endpoint. An account-scoped lock would not prevent a `start-instance(A)` from racing with an
`ensure-instances` that also touches A, because `ensure-instances` holds no lock for its full
duration.

### Persisted readiness store (SQLite or file)

Would survive process restarts. Rejected because `check-status` is designed to be
launcher-independent — it reads OS state directly. A persistent store would need its own
consistency management and would diverge from ground truth if the host reboots. In-process memory
is ephemeral but always consistent with the live OS view.

### Debounce threshold instead of grace window

Trigger `stuck` only after N consecutive unreachable checks. Rejected because check frequency is
variable (callers poll on their own schedule) and time-based reasoning ("was unreachable for
2 minutes") is more intuitive than count-based reasoning ("was unreachable 5 times in a row").

## Consequences

**Positive:**

- Concurrent launcher writes are safe without external locking infrastructure.
- Transient unavailability (LinkedIn navigation, slow start) no longer triggers spurious restarts.
- `check-status --json` exposes `readiness` per instance, giving agents and operators a stable
  signal to act on.
- `waitForConnectable` unifies the "block until healthy" pattern across restart, ensure, and
  the settle barrier.

**Negative:**

- The promise-chain queue is invisible: there is no API to inspect queue depth or cancel a
  pending operation. Callers must tolerate latency when a long operation is in-flight.
- The readiness tracker state is lost on process restart. Fresh runs start all instances in
  `starting` state until they are observed connectable.
- The settle barrier adds latency to every queued operation (up to `LHREMOTE_SETTLE_BARRIER_TIMEOUT_MS`
  in the worst case). Operations that don't benefit from settling (e.g. `stop-instance` followed
  immediately by a `check-status`) still pay the cost.

**Neutral:**

- The 1 500 ms process cache TTL is a pragmatic constant. If it becomes a problem (stale reads
  in rapid automation loops), callers can call `invalidateProcessCache()` directly.
- `LHREMOTE_GRACE_WINDOW_MS` and related env-var knobs allow operators to tune timing without
  code changes. Defaults are conservative (2 min grace, 8 s settle) to handle slow machines.
