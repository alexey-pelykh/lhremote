# ADR-002: CDP-Based Automation via Electron Remote Debugging

## Status

Accepted

## Context

LinkedHelper is a desktop application built on Electron that automates LinkedIn interactions. To build external tooling (CLI, MCP server) that controls LinkedHelper programmatically, we need a way to communicate with the running application.

LinkedHelper exposes no official API or plugin system. The application runs as an Electron process with a launcher window (managing LinkedIn account instances) and one child process per active LinkedIn account.

Requirements:

- Send commands to the launcher (start/stop instances, query state)
- Send commands to individual account instances (visit profiles, send messages)
- Read application state without modifying the application binary
- Work cross-platform (macOS, Windows, Linux)

## Decision

Use Chrome DevTools Protocol (CDP) over WebSocket to communicate with LinkedHelper's Electron processes via remote debugging.

**Architecture:**

```
lhremote CDPClient
    │
    ├── WebSocket → Launcher process (port 9222)
    │   └── Runtime.evaluate → Electron @electron/remote API calls
    │
    └── WebSocket → Instance process (dynamic port)
        └── Runtime.evaluate → Instance-specific operations
```

**Key design choices:**

1. **Custom CDP client** rather than using Puppeteer or playwright — we need low-level control over the WebSocket connection and only use a subset of the protocol (`Runtime.evaluate`, `Page.navigate`, event subscriptions). A thin client avoids pulling in large browser automation frameworks.

2. **Port discovery via process enumeration** — the launcher listens on a known port (default 9222), but instance ports are dynamic. Discovery works by finding the launcher PID via `pid-port`, enumerating child processes via `ps-list`, and probing each candidate with an HTTP request to `/json/list` to verify it speaks CDP.

3. **Automatic reconnection** with exponential backoff (500ms base, max 5 attempts) — the Electron app may restart or instances may be cycled, so the CDP client handles transient disconnections transparently.

4. **Request/response correlation** via incremental message IDs — the CDP protocol multiplexes requests and events over a single WebSocket, so each outgoing request is tagged with a numeric ID and matched to its response.

## Alternatives Considered

### File-based IPC (named pipes, Unix sockets)

Would require modifying LinkedHelper or injecting code at startup. CDP is already available as a standard Electron feature without any application modification.

### HTTP API wrapper

Build an HTTP bridge that proxies to LinkedHelper. Adds an extra service to manage and deploy. CDP is already a well-documented protocol with typed definitions (`devtools-protocol` package).

### Electron IPC via preload injection

Inject a preload script to expose IPC channels. Requires modifying the application launch process and is fragile across LinkedHelper updates. CDP works with the unmodified application binary.

### Using Puppeteer or Playwright as CDP client

These libraries provide high-level browser automation APIs. However, they assume control over the browser lifecycle (launching, page management) and bring significant dependencies. Our use case only needs `Runtime.evaluate` and basic event handling on an already-running Electron app.

## Consequences

**Positive:**

- No modification to the LinkedHelper application binary required
- CDP is a stable, well-documented protocol with TypeScript type definitions
- Works cross-platform — Electron exposes CDP on all supported platforms
- The same protocol handles both launcher and instance communication
- Low-level WebSocket client is lightweight (~300 lines) with no heavy dependencies

**Negative:**

- CDP is an implementation detail of Electron/Chromium, not a guaranteed stable API — though the core Runtime and Page domains are effectively stable
- Port discovery via process enumeration is platform-dependent (different process listing tools per OS)
- Security consideration: CDP provides full JavaScript execution context in the target process — the connection must be local-only
- LinkedHelper could theoretically disable remote debugging in a future update, breaking the entire automation approach
- Error messages from evaluated JavaScript can be opaque — requires mapping CDP exceptions to domain-specific errors

**Neutral:**

- The custom CDP client is purpose-built and intentionally minimal — it only implements the subset of the protocol needed for automation, not a general-purpose CDP library
