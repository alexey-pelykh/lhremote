# Detect Running-but-Unreachable LinkedHelper Application

## Roadmap
- [x] Phase 0: Intent
- [x] Phase 1: Decomposition
- [x] Phase 2: Enrichment
- [x] Phase 3: Quality Gate
- [x] Phase 4: Structuring
- [x] Phase 5: Tracking
- [x] Phase 6: Verification

## Problem Statement

When LinkedHelper is running as an OS process but its CDP endpoint is not reachable (started manually without `--remote-debugging-port`, CDP crashed, or listening on a different port), lhremote reports **"LinkedHelper is not running"** and advises using `launch-app`. This is misleading: the app IS running, and launching again spawns a conflicting second process.

The detection capability already exists — `findApp()` in `app-discovery.ts` scans for LH processes via `ps-list` and probes CDP connectivity, returning `{ pid, cdpPort, connectable }`. However, this function is only exposed as a standalone diagnostic tool (`find-app` MCP tool / CLI command) and is never called in the error-handling paths of `LauncherService.connect()`, `AppService.launch()`, or `checkStatus()`.

**For whom**: All lhremote users (MCP tool consumers, CLI users).

**Why now**: The gap produces incorrect error messages and can cause duplicate LH processes, which is a confusing and potentially destructive failure mode.

## Success Criteria

1. When LH is running but CDP is unreachable, error messages accurately describe the situation (not "not running")
2. `launch-app` / `AppService.launch()` does not silently spawn a second LH process when one already exists
3. `check-status` enriches its report with process-level detection when CDP is unreachable
4. Existing `find-app` behavior is unchanged (no regressions)

## Boundaries

### In Scope
- Integrating `findApp()` into error paths of `LauncherService.connect()`, `AppService.launch()`, and `checkStatus()`
- New error class to distinguish "not running" from "running but unreachable"
- `force` parameter on `AppService.launch()` and `launch-app` MCP tool to kill stale processes
- MCP error mapping for the new error type
- Unit tests for new error paths

### Out of Scope
- Changes to how `findApp()` itself works (already functional)
- CLI-specific UX changes beyond error message updates (CLI uses the same core services)

### Constraints
- `findApp()` uses `ps-list` and `pid-port` — both are already dependencies, but they add latency (~100-500ms). Call only on error paths and proactive launch checks, never on happy-path connections.
- All connections are local — no remote CDP host scenarios to handle.

### Decisions
- **Proactive detection**: `findApp()` is called proactively before spawning (not just on error paths)
- **Report + force**: Default behavior reports the conflict; `launch()` accepts a `force` flag to kill existing and relaunch
- **Local-only**: Remote connections are not a use case; no special handling needed

## Components

### 1. Error class: `LinkedHelperUnreachableError`
**Description**: New error type in `packages/core/src/services/errors.ts` distinguishing "process running but CDP unreachable" from "process not running at all". Carries discovered process info (PIDs).
**Dependencies**: None

### 2. LauncherService.connect() — process-aware error reporting
**Description**: When CDP connection fails in `LauncherService.connect()`, call `findApp()` to check if LH processes exist. If found with `connectable: false`, throw `LinkedHelperUnreachableError` instead of `LinkedHelperNotRunningError`.
**Dependencies**: Component 1

### 3. AppService.launch() — proactive conflict detection + force flag
**Description**: Before spawning a new LH process, call `findApp()`. If existing processes found: (a) if `connectable`, skip launch (existing behavior); (b) if not connectable, throw `LinkedHelperUnreachableError` unless `force: true`, in which case kill existing processes and proceed with launch. Add `force` option to `AppServiceOptions`.
**Dependencies**: Component 1

### 4. checkStatus() — process-level enrichment
**Description**: When launcher is unreachable, call `findApp()` and include process detection results in the `StatusReport`. Add optional `processes` field to `LauncherStatus` with discovered PID/port/connectable info.
**Dependencies**: None (uses `findApp()` directly)

### 5. MCP layer — error mapping + launch-app force flag
**Description**: Map `LinkedHelperUnreachableError` to an actionable MCP error message (e.g., "LinkedHelper is running (PID X) but CDP is not reachable. Restart it or use launch-app with force."). Add `force` parameter to `launch-app` MCP tool schema.
**Dependencies**: Components 1, 3

### 6. Unit tests
**Description**: Tests for all new error paths: `LinkedHelperUnreachableError` construction, `LauncherService.connect()` process-aware errors, `AppService.launch()` conflict detection and force behavior, `checkStatus()` process enrichment, MCP error mapping.
**Dependencies**: Components 1–5

## Component Map
```
Component 1 (Error class) -> Component 2 (LauncherService)
Component 1 (Error class) -> Component 3 (AppService)
Component 1 (Error class) -> Component 5 (MCP layer)
Component 3 (AppService) -> Component 5 (MCP layer)
Component 1–5 -> Component 6 (Tests)
```

## Work Items

### unreachable-error-class
**Type**: technical-task
**Component**: 1 — Error class
**Priority**: Must

**Acceptance Criteria**:
- Given a LinkedHelper process is detected by `findApp()` with `connectable: false`, When `LinkedHelperUnreachableError` is constructed with the discovered processes, Then it includes PIDs in its message and is distinguishable from `LinkedHelperNotRunningError` via `instanceof`
- Given `LinkedHelperUnreachableError` extends `ServiceError`, When caught in generic error handlers, Then it is handled as a `ServiceError`

**Affected Areas**:
- `packages/core/src/services/errors.ts`: add `LinkedHelperUnreachableError` class
- `packages/core/src/index.ts`: export new error class

**Dependencies**:
- blocks: [launcher-connect-detection, app-launch-detection, mcp-error-mapping]
- blocked_by: []

### launcher-connect-detection
**Type**: technical-task
**Component**: 2 — LauncherService.connect()
**Priority**: Must

**Acceptance Criteria**:
- Given LH process is running but CDP is unreachable on the launcher port, When `LauncherService.connect()` is called, Then it throws `LinkedHelperUnreachableError` (not `LinkedHelperNotRunningError`) with the detected PID(s)
- Given no LH process is running and CDP is unreachable, When `LauncherService.connect()` is called, Then it throws `LinkedHelperNotRunningError` (existing behavior unchanged)
- Given LH is running and CDP is reachable, When `LauncherService.connect()` is called, Then it connects successfully without calling `findApp()` (no happy-path latency)

**Affected Areas**:
- `packages/core/src/services/launcher.ts`: modify `connect()` error handling (lines 48-59)

**Dependencies**:
- blocks: []
- blocked_by: [unreachable-error-class]

### app-launch-detection
**Type**: technical-task
**Component**: 3 — AppService.launch()
**Priority**: Must

**Acceptance Criteria**:
- Given LH process exists (detected by `findApp()`), When `launch()` is called without `force`, Then it throws `LinkedHelperUnreachableError` with detected PIDs (does not spawn second process)
- Given LH process exists, When `launch()` is called with `force: true`, Then it kills the existing process(es) and launches a new one with CDP enabled
- Given no LH process exists, When `launch()` is called, Then it launches normally (existing behavior)
- Given LH is already running with CDP reachable on the assigned port, When `launch()` is called, Then it returns without action (existing early-return behavior preserved)

**Affected Areas**:
- `packages/core/src/services/app.ts`: add `force` to options, modify `launch()` to call `findApp()` proactively

**Dependencies**:
- blocks: [mcp-error-mapping]
- blocked_by: [unreachable-error-class]

### status-process-enrichment
**Type**: technical-task
**Component**: 4 — checkStatus()
**Priority**: Must

**Acceptance Criteria**:
- Given launcher CDP is unreachable and LH processes are running, When `checkStatus()` is called, Then the `StatusReport.launcher` includes a `processes` field with detected PID/port/connectable info
- Given launcher CDP is unreachable and no LH processes exist, When `checkStatus()` is called, Then `processes` is an empty array (or omitted)
- Given launcher CDP is reachable, When `checkStatus()` is called, Then it does not call `findApp()` (no unnecessary latency)

**Affected Areas**:
- `packages/core/src/services/status.ts`: call `findApp()` when launcher unreachable, extend `LauncherStatus` type

**Dependencies**:
- blocks: []
- blocked_by: []

### mcp-error-mapping
**Type**: technical-task
**Component**: 5 — MCP layer
**Priority**: Must

**Acceptance Criteria**:
- Given `LinkedHelperUnreachableError` is thrown, When MCP error mapping processes it, Then the response message says "LinkedHelper is running (PID X) but CDP is not reachable. Restart it or use launch-app with force: true."
- Given `launch-app` tool is called with `force: true`, When LH is running but unreachable, Then it kills existing and relaunches (delegates to `AppService.launch({ force: true })`)
- Given `launch-app` tool is called without `force`, When LH is running but unreachable, Then it returns the actionable error message

**Affected Areas**:
- `packages/mcp/src/helpers.ts`: add `LinkedHelperUnreachableError` mapping in `mapErrorToMcpResponse()`
- `packages/mcp/src/tools/launch-app.ts`: add `force` parameter to schema, pass to `AppService`

**Dependencies**:
- blocks: []
- blocked_by: [unreachable-error-class, app-launch-detection]

### unreachable-detection-tests
**Type**: technical-task
**Component**: 6 — Tests
**Priority**: Must

**Acceptance Criteria**:
- Given the test suite, When tests run, Then there are unit tests covering: `LinkedHelperUnreachableError` construction/instanceof, `LauncherService.connect()` throwing correct error type based on process state, `AppService.launch()` conflict detection (with and without force), `checkStatus()` process enrichment, and MCP error mapping for the new error type

**Affected Areas**:
- `packages/core/src/services/errors.test.ts` (or new file): error class tests
- `packages/core/src/services/launcher.test.ts`: connect() error path tests
- `packages/core/src/services/app.test.ts`: launch() conflict detection tests
- `packages/core/src/services/status.test.ts`: process enrichment tests
- `packages/mcp/src/helpers.test.ts`: error mapping tests

**Dependencies**:
- blocks: []
- blocked_by: [unreachable-error-class, launcher-connect-detection, app-launch-detection, status-process-enrichment, mcp-error-mapping]

## Tracker References

| Work Item | Tracker Ref | Type | Status |
|-----------|-------------|------|--------|
| unreachable-error-class | #393 | technical-task | created |
| launcher-connect-detection | #394 | technical-task | created |
| app-launch-detection | #395 | technical-task | created |
| status-process-enrichment | #396 | technical-task | created |
| mcp-error-mapping | #397 | technical-task | created |
| unreachable-detection-tests | #398 | technical-task | created |

**Tracking System**: GitHub Issues (Tier 1)
**Created**: 2026-03-17

## Readiness State

| Work Item | Tracker | Clear Outcome | Testable AC | Bounded | Deps | No Blockers | Status |
|-----------|---------|---------------|-------------|---------|------|-------------|--------|
| unreachable-error-class | #393 | PASS | PASS | PASS | PASS | PASS | READY |
| launcher-connect-detection | #394 | PASS | PASS | PASS | PASS | PASS | READY |
| app-launch-detection | #395 | PASS | PASS | PASS | PASS | PASS | READY |
| status-process-enrichment | #396 | PASS | PASS | PASS | PASS | PASS | READY |
| mcp-error-mapping | #397 | PASS | PASS | PASS | PASS | PASS | READY |
| unreachable-detection-tests | #398 | PASS | PASS | PASS | PASS | PASS | READY |

## Dependency Graph
```
unreachable-error-class -> launcher-connect-detection
unreachable-error-class -> app-launch-detection
unreachable-error-class -> mcp-error-mapping
app-launch-detection -> mcp-error-mapping
unreachable-error-class -> unreachable-detection-tests
launcher-connect-detection -> unreachable-detection-tests
app-launch-detection -> unreachable-detection-tests
status-process-enrichment -> unreachable-detection-tests
mcp-error-mapping -> unreachable-detection-tests
```
