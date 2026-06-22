# Instance Visibility: Process-Role Taxonomy and Identity Resolution

> **Audience**: contributors and operators running lhremote in multi-account environments.

## Why this document exists

The original `find-app` implementation classified every LinkedHelper process by parent-PID alone.  In practice, a single running account produces 10–15 Chromium helper processes (gpu, renderer, utility, crashpad) that all share the same binary name.  With 3 accounts running, this produced 40+ "instance" rows and no per-instance identity — making the most basic operational question ("which accounts are started?") unanswerable without a live launcher CDP connection.

This document describes the ground truth uncovered from real process trees and the taxonomy now used by the codebase.

---

## Process-role taxonomy

### 1. Launcher (`role: "launcher"`)

- Executable path: `…\app-X.Y.Z\linked-helper.exe` (NOT under `resources\out\`)
- Command line contains `--remote-debugging-port=<port>` (typically 9222)
- Listens on a fixed CDP port; this is the entry point for `list-accounts`, `start-instance`, `stop-instance`
- Its direct children (crashpad, gpu, renderer) are **launcher helper children**, not account instances

### 2. Account-instance main process (`role: "instance"`)

- Executable path: `…\resources\out\linked-helper.exe` (note: subdirectory `resources\out\`)
- Command line contains `--app-id=<accountId>` and `--user-li-id=<accountId>` with no `--type=` flag
- Listens on a **dynamic** CDP port chosen at startup (changes every session)
- One process per running LinkedIn account

### 3. Chromium helper children (`role: "helper-child"`)

- Identified by the presence of `--type=<kind>` in the command line
- `kind` is one of: `gpu-process`, `renderer`, `utility`, `crashpad-handler`
- These share the same binary name as the launcher and instances
- **NEVER** expose a CDP port; **NEVER** represent an account
- Parent PID (`ppid`) points to the instance main process or the launcher

#### Classification rules (applied in order)

| Condition | Role |
|-----------|------|
| Command line contains `--type=` | `helper-child` |
| Path contains `resources[\/]out[\/]` (no `--type=`) | `instance` |
| Path does NOT contain `resources[\/]out[\/]` | `launcher` |
| Fallback (no command line available) | parent-PID heuristic |

---

## Identity fields on the instance command line

Each account-instance main process carries account identity in its command line arguments.  These are parsed by `parseIdentityFromCmdline` using a strict allowlist.

### Allowlisted fields (safe to extract)

| Argument | Content |
|----------|---------|
| `--app-id=<N>` | Primary account ID (integer) |
| `--user-li-id=<N>` | LinkedIn ID (usually equals `--app-id`) |
| `--user-li={"id":N,"fullName":"…","email":"…","avatar":"…"}` | JSON with identity details |

Resolution order: `--app-id` → `--user-li-id` → `id` field inside `--user-li`.

### The `--lh-account` decoy trap ⚠️

Every instance also carries:

```
--lh-account={"email":"license-owner@example.com","fullName":"License Owner"}
```

This is the **license-owner** identity (the person who purchased LinkedHelper) and is **identical across all instances**.  A parser that keys off `--lh-account` will label every instance as the same person.

**Rule: always key off `--user-li-id` / `--app-id`.  Never `--lh-account`.**

The parser explicitly ignores `--lh-account`.

---

## Secrets on the command line (redaction requirements)

The instance command line contains live credentials that must never be captured, logged, stored, serialized, or returned in tool output:

| Argument | Content |
|----------|---------|
| `--app-credentials=…` | Encrypted LinkedIn password |
| `--upstream-proxy=socks5://user:password@host` | **Plaintext** proxy credentials |
| `--sentry=https://key@sentry.io/…` | Sentry DSN |

The `parseIdentityFromCmdline` function implements an **allowlist** parser: it only reads the fields listed in the previous section.  Raw command lines are local variables inside `process-inspector.ts` and are never exported or included in function return values.

---

## `source` and `confidence` semantics

Every `RunningInstance` and `InstanceIdentity` carries provenance metadata:

| `source` | `confidence` | Meaning |
|---------|------------|---------|
| `"cmdline"` | `"high"` | Parsed from `--app-id`/`--user-li-id`/`--user-li` — no CDP needed |
| `"cmdline"` | `"unknown"` | Process is an instance-side process but lacked identity fields |
| `"cdp"` | `"high"` | Queried from the running instance over its CDP port |
| `"launcher"` | `"low"` | Derived from the launcher account mapping (requires live launcher) |

The `runningInstances[]` array in `StatusReport` is populated exclusively by `source: "cmdline"` entries from `scanRunningInstances()`.  It is the **authoritative** "which accounts are started" source and works even when the launcher CDP is unreachable.

---

## Launcher auto-recovery policy (F3)

When the launcher CDP drops (for example while reconciling instances after a fresh launch), `resolveLauncherPort` retries with 1-second intervals for up to **30 seconds** (`REACHABILITY_RETRY_TIMEOUT`).  This window is enough for LinkedHelper to re-bind its debugging port.

- Status queries (`check-status`) always succeed during a launcher outage because `runningInstances[]` is populated from process inspection, independent of the launcher.
- Launcher operations (`start-instance`, `stop-instance`, `list-accounts`) will block and retry within the 30-second cap before failing with a structured error.

---

## `instances[]` / `runningInstances[]` display model

`StatusReport.instances` and `StatusReport.runningInstances` are the same array, both populated from `scanRunningInstances()`.  `instances[]` is the authoritative field; `runningInstances[]` is retained as a backward-compat alias.

`check-status` returns:

```json
{
  "runningInstances": [
    {
      "accountId": 347559,
      "name": "Vira Lyn",
      "email": "vira@example.com",
      "pid": 13004,
      "cdpPort": 54321,
      "connectable": true,
      "helperChildCount": 11,
      "source": "cmdline",
      "confidence": "high"
    }
  ]
}
```

- Results are sorted **connectable-first**.
- Helper children appear **only** as `helperChildCount` on the owning instance row — never as top-level rows.
- A non-connectable instance main process IS shown (it is a real fault condition worth investigating).

---

## Orphan detection (F5)

A **true orphan** is narrowly defined:

- Is an account-instance-side process (path contains `resources\out\`, or has `--app-id`)
- Is **non-connectable** (no live CDP port responds)
- Is **not** a helper child (`--type=` absent)
- Is **not** the live instance for any account in the `runningInstances[]` result

Chromium helper children are **never** orphans, even if their parent has exited.  The OS will reap them.

`reap-orphans` requires `confirm: true` and will never terminate a connectable process, the launcher, any `--type=` child of a live parent, or a process mapped to a known account.

---

## File locations

| File | Purpose |
|------|---------|
| `packages/core/src/cdp/gather-raw-processes.ts` | Shared OS process list with cmdlines (Win32_Process on Windows) |
| `packages/core/src/cdp/process-inspector.ts` | Process scanning, identity parsing, orphan detection |
| `packages/core/src/cdp/app-discovery.ts` | `findApp()` — full process tree with `helperChildCount` and `includeHelpers` |
| `packages/core/src/services/status.ts` | `checkStatus()` with `instances[]` and `runningInstances[]` from process inspection |
| `packages/core/src/services/instance-lifecycle.ts` | `startInstanceWithRecovery()` with post-start verification |
| `packages/core/src/services/ensure-instances.ts` | `ensureInstances()` idempotent multi-start |
| `packages/core/src/cdp/process-inspector.test.ts` | Unit tests (mock `gatherRawProcesses`, `pid-port`) |
| `packages/core/src/cdp/app-discovery.test.ts` | Unit tests for `findApp()` including 3-not-7 regression |
