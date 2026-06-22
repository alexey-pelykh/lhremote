# Instance Stability: Launcher Queue & Readiness Model

> Added in v0.22.0

## Problem Background

LinkedHelper runs one launcher process and zero-or-more account instances. Each instance starts via a `--lh-account <id>` flag and communicates over a dynamically assigned CDP port. Rapid lifecycle operations (back-to-back starts, parallel ensure-instances calls) caused a cascade:

1. First `start` causes the launcher's CDP to blip (~2-3 s)
2. Second `start` arrives during the blip → fails with "launcher not reachable"
3. Recovery spawns a parallel reconnection path → phantom port reported
4. `ensure-instances` sees snapshot mismatch → marks instances `verified:false` even when they are actually up

The root causes were: no serialisation of launcher-touching ops, no stable readiness notion, and expensive WMI polling inside tight retry loops.

## Solutions

### 1. Launcher Operation Queue (`launcher-queue.ts`)

All write/lifecycle operations are serialised through a single module-level async promise chain (`_queueTail`). Only one operation runs at a time; all others wait.

```
op1 → [settle] → op2 → [settle] → op3 ...
```

**Settle barrier**: after each op, the queue holds for up to `LHREMOTE_SETTLE_BARRIER_TIMEOUT_MS` while:
- `resolveAppPort("launcher", ...)` — confirms the launcher CDP recovered
- (for starts only) `waitForConnectable(accountId, ...)` — confirms the new instance is connectable

Both steps are best-effort (errors swallowed). The cache is invalidated in `finally` regardless.

**Reads are not queued**: `check-status`, `find-app`, `query-*` and similar inspection tools never enter the queue. They rely on process inspection only, so launcher CDP state is irrelevant.

### 2. Instance Readiness Model (`instance-readiness.ts`)

A process-scoped singleton `InstanceReadinessTracker` maps each PID to one of four states:

| State | Meaning |
|-------|---------|
| `connectable` | CDP port is reachable and responding |
| `starting` | Not yet seen connectable; still initializing |
| `degraded` | Was connectable; now unreachable but within the grace window |
| `stuck` | Unreachable past the grace window — needs intervention |

The tracker remembers two sets per PID:
- `seenConnectable`: PIDs ever observed as connectable
- `unreachableSince`: timestamp when the PID first became non-connectable

**State machine logic on each update**:

```
connectable?    → state = "connectable"  (clear unreachableSince entry)
not connectable:
  seenConnectable?
    elapsed ≥ graceWindowMs → state = "stuck"
    else                    → state = "degraded"
  never seen connectable    → state = "starting"
```

Stale PIDs (no longer in the scan) are pruned automatically. `invalidate(pid)` clears history for a single PID (used after restart).

### 3. `waitForConnectable(accountId, opts)`

Polls until the target account's instance is connectable, using a two-path strategy:

1. **Cheap path** (when `knownPort` is supplied): `isCdpPort(knownPort)` — single TCP connect, no WMI. Returns in ~5 ms when the port is up.
2. **Full scan path**: `scanRunningInstances()` — full WMI inspection. Used when cheap path fails or no known port.

Returns `WaitForConnectableResult { cdpPort, pid, verified }`. `verified:false` means the deadline was reached without observing the account as connectable.

### 4. Process Inspection Cache (`gather-raw-processes.ts`)

`gatherRawProcesses()` caches its result for `LHREMOTE_INSPECTION_CACHE_TTL_MS` (default 1 500 ms). During tight poll loops this eliminates redundant WMI calls. The cache is invalidated:

- In `withLauncherQueue`'s `finally` block (after every lifecycle op)
- In `waitForPidExit` before each poll iteration

### 5. `waitForPidExit(pid, timeoutMs?)`

Polls `process.kill(pid, 0)` (signal-0: checks existence without sending a signal). `ESRCH` error → process is gone. `EPERM` or no error → still alive. Used by `restart-instance` and the hardened `stop-instance` to ensure the old process is fully gone before starting a replacement.

## `restart-instance` Operation Sequence

```
withLauncherQueue(
  1. scan for existing instance (accountId)
  2. if connectable && !force → return {restarted:false}
  3. launcher.stopInstance(accountId)          ← only target account
  4. waitForPidExit(oldPid)
  5. withLauncherRecovery(startInstanceWithRecovery)
  6. waitForConnectable(accountId, {knownPort})
  7. distinct-port check (new port ≠ old port)
  8. return result
, settle={type:"start", accountId, launcherPort}
)
```

No other account's process is stopped or signalled. Distinct-port check guards against phantom port reporting.

## `ensure-instances` Two-Phase Flow

**Phase 1 (serialised through queue)**:
```
for each accountId:
  re-scan
  if connectable → mark already_running, skip
  withLauncherQueue(startInstanceWithRecovery, settle={type:"start"})
```

**Phase 2 (parallel verification)**:
```
Promise.all(unverifiedAccounts.map(a => waitForConnectable(a.accountId, {knownPort})))
```

Phase 2 gives every account the full connectable timeout to settle after the queue chain finishes. An account whose process never appears (unlicensed) is reported as `status:"failed"` with a clear reason.

## Read vs Write Reliability Boundary

| Operation category | Launcher CDP required? | Queued? |
|-------------------|------------------------|---------|
| `check-status`, `find-app` | No | No |
| `query-profiles`, `query-messages`, etc. | No | No |
| `start-instance`, `stop-instance`, `restart-instance` | Yes | Yes |
| `launch-app`, `quit-app` | Yes | Yes |
| `list-accounts` | Yes | Yes |
| `ensure-instances` (Phase 1) | Yes | Yes (per account) |
| `ensure-instances` (Phase 2, `waitForConnectable`) | No | No |

Reads work even during launcher recovery. Writes wait for the queue and the settle barrier.

## Configuration Knobs

All timing constants have sane defaults and are overridable via environment variables:

| Env var | Default | Rationale |
|---------|---------|-----------|
| `LHREMOTE_GRACE_WINDOW_MS` | `30000` | 30 s covers typical LinkedHelper re-bind time on slow machines |
| `LHREMOTE_CONNECTABLE_TIMEOUT_MS` | `45000` | 45 s: grace + overhead for slow starts |
| `LHREMOTE_CONNECTABLE_INTERVAL_MS` | `1500` | Matches cache TTL — no faster polling than cache refresh |
| `LHREMOTE_SETTLE_BARRIER_TIMEOUT_MS` | `30000` | Same as grace window; after 30 s the next op won't benefit from more waiting |
| `LHREMOTE_INSPECTION_CACHE_TTL_MS` | `1500` | Amortises WMI cost across poll loops without becoming stale |
| `LHREMOTE_LAUNCHER_RECOVERY_TIMEOUT_MS` | `30000` | (existing) Cap for auto-reconnect on CDP drop |

Reduce all values in integration test environments to speed up test runs. Increase `LHREMOTE_CONNECTABLE_TIMEOUT_MS` on machines with very slow disk/startup (e.g. under heavy I/O load).

## `check-status` Readiness Field

`check-status` now includes `readiness` on each instance entry:

```json
{
  "instances": [
    {
      "accountId": 42,
      "cdpPort": 55001,
      "connectable": true,
      "readiness": "connectable"
    }
  ]
}
```

Use `readiness` to distinguish `starting` (normal initialisation) from `stuck` (needs `restart-instance`). Do not restart on `degraded` — wait out the grace window first.
