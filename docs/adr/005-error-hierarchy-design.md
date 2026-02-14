# ADR-005: Error Hierarchy Design

## Status

Accepted

## Context

lhremote operates across four distinct layers — CDP protocol communication, database access, format/validation, and service orchestration — each with its own failure modes. Errors from these layers surface through the MCP server and CLI, which need to provide meaningful feedback to users and AI agents.

Without custom errors, all failures would be generic `Error` instances, making it impossible to distinguish "LinkedHelper is not running" from "profile not found in database" from "invalid campaign YAML" from "CDP WebSocket timed out" without parsing error message strings.

## Decision

Define a four-tier error hierarchy with domain-specific base classes, each extending `Error`:

```
Error (built-in)
├── CDPError                        (packages/core/src/cdp/errors.ts)
│   ├── CDPConnectionError          WebSocket connection failures
│   ├── CDPTimeoutError             Request/event timeout
│   └── CDPEvaluationError          Runtime.evaluate exceptions
│
├── DatabaseError                   (packages/core/src/db/errors.ts)
│   ├── DatabaseNotFoundError       Database file missing for account
│   ├── ProfileNotFoundError        Profile lookup returned no results
│   ├── CampaignNotFoundError       Campaign lookup returned no results
│   ├── ChatNotFoundError           Chat lookup returned no results
│   ├── ActionNotFoundError         Campaign action not found
│   ├── NoNextActionError           Action is terminal in chain
│   └── ExcludeListNotFoundError    Exclude list not found
│
├── FormatError                     (packages/core/src/formats/errors.ts)
│   └── CampaignFormatError         Campaign document structural validation failed
│
└── ServiceError                    (packages/core/src/services/errors.ts)
    ├── AppNotFoundError            LinkedHelper binary not found
    ├── AppLaunchError              Process spawn failed
    ├── LinkedHelperNotRunningError CDP endpoint not reachable
    ├── InstanceNotRunningError     Expected instance not running
    ├── StartInstanceError          Account instance failed to start
    ├── WrongPortError              CDP port is instance, not launcher
    ├── ActionExecutionError        Action execution failed (carries actionType)
    ├── InvalidProfileUrlError      Profile URL validation failed
    ├── ExtractionTimeoutError      Profile data didn't appear in DB in time
    ├── CampaignExecutionError      Campaign operation failed (carries campaignId)
    ├── CampaignTimeoutError        Campaign state transition timeout (carries campaignId)
    └── AccountResolutionError      Account resolution ambiguous (carries reason: "no-accounts" | "multiple-accounts")
```

**Key design choices:**

1. **Four independent base classes** (`CDPError`, `DatabaseError`, `FormatError`, `ServiceError`) rather than a single project-wide base — each base class maps to an architectural layer, enabling layer-specific catch blocks.

2. **Errors carry domain context** — `ActionExecutionError` includes `actionType`, `CampaignExecutionError` and `CampaignTimeoutError` include `campaignId`, `ProfileNotFoundError` handles both numeric ID and public slug identifiers. This context enables meaningful user-facing messages.

3. **Error propagation follows the layer stack** — low-level CDP or database errors can be caught by the service layer and either re-thrown as-is or wrapped in a service-level error with additional context. MCP/CLI handlers catch at the top level.

4. **All custom errors support `ErrorOptions`** (the `cause` property) — enabling error chaining when wrapping lower-level errors.

5. **Each error sets `this.name`** explicitly — ensuring `error.name` reflects the specific error class rather than a generic "Error", which is important for serialization in MCP responses and CLI output.

## Alternatives Considered

### Error codes (string/numeric) on a single error class

Use a single `LHRemoteError` with a `code` property (e.g., `"CDP_TIMEOUT"`, `"DB_NOT_FOUND"`). This is common in Node.js core. However, it prevents `instanceof` checks and requires string comparison for error handling. Separate classes enable type-safe catch blocks and IDE-assisted error handling.

### Result types (discriminated unions)

Return `{ ok: true, value: T } | { ok: false, error: E }` instead of throwing. This pattern works well in Rust and functional TypeScript but would require changing every function signature in the call chain. The Node.js ecosystem convention is throw/catch, and the MCP SDK and Commander.js frameworks expect thrown errors.

### Single base class for all errors

One `LHRemoteError` base with all specific errors extending it. This enables a single `catch (e instanceof LHRemoteError)` for broad handling. However, the three layers (CDP, database, service) have genuinely different failure modes and recovery strategies. A single hierarchy would obscure whether an error is a protocol issue, a data issue, or an application issue.

### No custom errors

Throw standard `Error` with descriptive messages. Simpler but forces all error handling to rely on message string parsing, which is fragile and prevents programmatic differentiation between error types.

## Consequences

**Positive:**

- `instanceof` checks enable precise error handling at each layer boundary
- Domain context on errors (actionType, campaignId, identifier) enables meaningful diagnostics without parsing messages
- MCP tool handlers can map specific error types to appropriate MCP error codes
- CLI handlers can format error messages differently based on error type (e.g., "not found" vs "timeout" vs "connection failed")
- Error chaining via `cause` preserves the full failure chain for debugging

**Negative:**

- Each new failure mode requires defining a new error class — adds boilerplate
- Four independent hierarchies mean you cannot catch "any lhremote error" with a single `instanceof` check
- Error classes must be exported and imported across package boundaries, adding to the public API surface

**Neutral:**

- The error hierarchy mirrors the package architecture (CDP, DB, Formats, Services) — changes to the layer structure would require corresponding error reorganization
