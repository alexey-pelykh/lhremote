# ADR-005: Error Hierarchy Design

## Status

Accepted — amended 2026-09-05 (see § Amendments)

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
│   ├── CampaignNotFoundError       Campaign lookup returned no results (carries campaignId)
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
    ├── LinkedHelperUnreachableError Process found but CDP not reachable (carries processes)
    ├── InstanceNotRunningError     Expected instance not running
    ├── StartInstanceError          Account instance failed to start
    ├── WrongPortError              CDP port is instance, not launcher (carries port)
    ├── NodeIntegrationUnavailableError Launcher lacks Node.js APIs (unsupported LH version)
    ├── ActionExecutionError        Action execution failed (carries actionType)
    ├── InvalidProfileUrlError      Profile URL validation failed
    ├── ExtractionTimeoutError      DB profile or DOM readiness deadline expired (carries target, timeoutMs, subject)
    ├── DOMVariantUnsupportedError  No DOM adapter matched the page, or the one that did resolved no scope (carries surface, triedVariants)
    ├── ExtractionFailedError       Matched adapter, empty field, contradicting corroborator (carries surface, variant, field, corroborator)
    ├── DOMVariantAmbiguousError    Two or more DOM adapters matched the page (carries surface, matchedVariants)
    ├── CollectionError             Collection operation failed during execution
    │   └── CollectionBusyError     Instance busy, cannot start collection (carries runnerState)
    ├── CampaignExecutionError      Campaign operation failed (carries campaignId)
    ├── CampaignTimeoutError        Campaign state transition timeout (carries campaignId)
    ├── BudgetExceededError         Daily action budget exhausted (carries limitType, dailyLimit, totalUsed)
    ├── UIBlockedError              UI blocked by dialog/error/popup (carries health)
    ├── AccountResolutionError      Account resolution ambiguous (carries reason: "no-accounts" | "multiple-accounts")
    ├── MonitorCollectingSagaTimeoutError Saga never reached idle (carries waitedMs, recoveryEvents, popupsDismissed, unrecoverablePopups)
    ├── LoggedInStateTimeoutError   ContentWindow never entered LoggedInState (carries waitedMs, lastReason)
    └── LoggedInStatePersistedError Stuck in non-LoggedInState after the retry budget (carries waitedMs, innerError)
```

The path beside each **base class** locates that base's own declaration file — not the
enumeration's scope. Several subclasses above are declared elsewhere under
`packages/core/src/`; see § Amendments (2026-09-05).

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

## Amendments

### 2026-09-05 — Enumeration realigned with the code; `ExtractionTimeoutError` widened (#849)

The tree in § Decision had drifted from the code: six `ServiceError` subclasses
existed and were not listed. As of this amendment it lists every subclass of the
four base classes — nothing in code is missing from it, and nothing in it is
absent from code.

Three of the six arrived with the DOM-variant work (#832), and they are what
ADR-008's empty-vs-error contract names:

- `DOMVariantUnsupportedError` — no registered adapter recognises the page, or the
  one that matched could not resolve its own scope. ADR-008 § 5 treats the two
  alike because neither read the page.
- `ExtractionFailedError` — an adapter matched, but a field came back empty
  while a same-observation corroborator contradicts that emptiness.
- `DOMVariantAmbiguousError` — two or more adapters claim the same page.

The other three predate that work and had simply gone unrecorded:
`MonitorCollectingSagaTimeoutError`, `LoggedInStateTimeoutError` and
`LoggedInStatePersistedError`.

`ExtractionTimeoutError` had also outgrown its one-line description. #847 gave it
a `subject` field and routed `waitForPostLoad` through it; `waitForReactionsModal`
and `waitForSearchResults` followed. It is no longer "profile data didn't appear
in the DB in time" — it is the deadline error for whichever subject was awaited,
and `subject` is what tells them apart. The description now names that mechanism
rather than enumerating the surfaces, which would drift again on the next one.
The `"Profile"` default remains for the original database-extraction call shape,
but no production call site relies on it — all three gates above pass an explicit
subject. It is a retained constructor affordance, not a live path, and the only
thing holding it is the unit test that pins it.

Two pre-existing rows also gained the `(carries …)` annotation the other
field-carrying rows already advertise: `WrongPortError` (`port`) and
`CampaignNotFoundError` (`campaignId`). A reader picking a `catch` block reads
that annotation as the class's carried context, so a silent omission sends them
back to parsing `error.message`.

**Two questions this amendment deliberately leaves open**, because both belong to
the ADR owner rather than to the edit that surfaced them:

1. **Whether the tree should stay exhaustive.** It has drifted before, silently,
   and it will drift again on every new error class. The alternatives are a
   mechanical check that fails when tree and code disagree, or reframing the block
   as explicitly illustrative so that a reader stops treating it as complete.
   Until that is settled, the tree is accurate *as of this amendment's date* and
   the source remains the authority.
2. **What the enumeration ranges over.** This amendment lists every subclass of
   the four base classes wherever it is declared, extending what the tree already
   did in part — `CampaignFormatError` (`formats/campaign-format.ts`) and
   `AccountResolutionError` (`services/account-resolution.ts`) were both listed
   while sitting outside their base's `errors.ts`. Those two stay inside their
   base's own layer directory, whereas the three operations-layer errors added
   here cross into `packages/core/src/operations/` — the layer ADR-006 introduced,
   which § Consequences above does not name. Including them is a judgment call,
   not a precedent that already covered them.

The Decision itself — four independent base classes, one per architectural
layer — is unchanged.
