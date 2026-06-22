# Development Specification

This document records implementation requirements for lhremote contributors. It complements the ADRs in `docs/adr/` with current development rules that should be preserved during feature work.

## Runtime Architecture

lhremote is a pnpm monorepo with three main packages:

| Package | Responsibility |
|---------|----------------|
| `@insoftex/lhremote-core` | CDP client, process discovery, services, database access, operations, shared errors |
| `@insoftex/lhremote-cli` | Commander-based CLI adapter over core operations |
| `@insoftex/lhremote-mcp` | Model Context Protocol adapter over core operations |

Core behavior belongs in `@insoftex/lhremote-core`. CLI and MCP packages should stay thin: parse input, call core, format output, and map errors to user-facing messages.

## App Lifecycle Requirements

`AppService` owns LinkedHelper application lifecycle behavior.

- Launch must start the unmodified LinkedHelper binary with `--remote-debugging-port=<port>`.
- When no explicit port is provided, launch must select a free port and report it.
- Existing LinkedHelper processes must be inspected before launching.
- A connectable process with role `launcher` may be reused.
- A connectable process with role `instance` must not be treated as the launcher.
- If only unreachable processes are found, launch must throw `LinkedHelperUnreachableError` unless `force` is set.
- `force` must kill existing LinkedHelper processes before relaunching.
- `ELECTRON_RUN_AS_NODE` must be removed from the spawned environment so Electron starts as a GUI app.
- `windowsHide: true` should remain on spawned helper processes to avoid transient console windows.
- Quit must not assume the launcher exposes page targets. If `/json/list` is empty, close the launcher through the browser-level CDP WebSocket discovered from `/json/version` with `Browser.close`.
- CLI and MCP app-management behavior must stay equivalent: omitted quit ports should resolve the connectable launcher port before falling back to `DEFAULT_CDP_PORT`.

## Windows Visibility

On Windows, `launch-app` must leave LinkedHelper visible and available for user interaction.

The foreground behavior is intentionally not implemented through CDP `Page.bringToFront`. LinkedHelper's launcher can expose a reachable CDP endpoint while `/json/list` contains zero page targets, so a CDP page-focus call can fail even though the application launched successfully.

Implementation requirements:

- Visibility is best-effort and must not turn a successful launch into a failed launch.
- Visibility defaults to enabled on Windows and disabled on other platforms.
- The CLI and MCP may pass `visible` explicitly, but undefined should preserve the platform default.
- The CLI opt-out flag is `--no-visible`.
- The visibility path must run after a fresh launch and when reusing an existing connectable launcher.
- The Windows implementation must enumerate top-level windows for all discovered LinkedHelper PIDs, including launcher and instance processes.
- It should restore minimized windows and attempt to set foreground focus.
- It should prefer windows titled like LinkedHelper and ignore Windows IME helper windows such as `MSCTFIME UI` and `Default IME`.
- Verbose logging should report whether a window was brought forward or why no candidate window was found.

## Process Discovery

`findApp()` is the source of truth for LinkedHelper process discovery.

- Binary names must be matched case-insensitively.
- Roles are inferred from the process tree:
  - `launcher`: parent is not another LinkedHelper process
  - `instance`: parent is another LinkedHelper process
  - `unknown`: reserved for ambiguous future cases
- CDP ports are detected by mapping PID to listening ports and probing candidates with `isCdpPort`.
- Discovery should return every LinkedHelper process, not only connectable ones, so diagnostics can explain stale or partially started states.

## Error Handling

- Core should throw typed errors from `packages/core/src/services/errors.ts`, CDP errors from `packages/core/src/cdp/errors.ts`, or database errors from the relevant database layer.
- CLI and MCP handlers should catch unknown errors at the boundary and use `errorMessage()`.
- Best-effort diagnostics, foregrounding, and cleanup should log through `onLog` where available and should not mask the primary operation result.

## Testing

Use the three-tier testing strategy described in `docs/adr/004-three-tier-testing-strategy.md`.

For app lifecycle changes, run at minimum:

```sh
pnpm --filter @insoftex/lhremote-core exec vitest run src/services/app.test.ts
pnpm --filter @insoftex/lhremote-core build
pnpm --filter @insoftex/lhremote-cli exec vitest run src/handlers/launch-app.test.ts src/program.test.ts
pnpm --filter @insoftex/lhremote-cli build
```

For Windows visibility changes, also perform a local smoke test with a real LinkedHelper installation:

```sh
lhremote quit-app
lhremote launch-app --verbose
lhremote find-app --verbose
```

Expected smoke-test result:

- `launch-app --verbose` reports a connectable launcher CDP port.
- On Windows, it logs `Brought LinkedHelper window to front: ...`.
- The LinkedHelper launcher is visible and accepts user interaction.

## Documentation

When changing user-visible behavior:

- Update the root `README.md` command reference.
- Update package READMEs when package-specific behavior changes.
- Add or amend an ADR when the change represents a durable architectural decision.
- Update this development specification when a maintenance rule or regression-prone behavior is discovered.
