# ADR-006: Operations Layer

## Status

Accepted

## Context

lhremote exposes automation capabilities through two user-facing interfaces — a CLI (`@lhremote/cli`) and an MCP server (`@lhremote/mcp`). Both interfaces need to perform the same business flows: resolve an account, open a database/instance context, call one or more services, and return a typed result.

Before the operations layer, this orchestration logic was duplicated across MCP tool handlers and CLI command handlers. With 30+ tool/command pairs, the duplication created divergence risk — a bug fix in one handler might not be applied to its counterpart — and made it harder to test business flows in isolation from interface concerns.

Services (e.g., `CampaignService`) encapsulate single-domain logic but do not handle cross-cutting concerns like account resolution or resource lifecycle management. A layer was needed between services and interface adapters to centralize this orchestration.

## Decision

Introduce `packages/core/src/operations/` as a layer between services and interface adapters (MCP tools / CLI handlers). Each operation:

- Accepts a typed input interface extending `ConnectionOptions` (from `operations/types.ts`), which carries CDP connection parameters (`cdpPort`, `cdpHost`, `allowRemote`)
- Resolves the target account via `resolveAccount()`
- Manages resource lifecycle via `withInstanceDatabase()` or `withDatabase()`
- Delegates domain logic to the appropriate service(s)
- Returns a typed output interface

The first exemplar is `campaignStatus` (introduced in commit `688117a`), which retrieves campaign execution status and optionally includes action results.

**Boundary with services:** Services encapsulate a single domain (e.g., `CampaignService` for campaign CRUD). Operations orchestrate across domains and infrastructure concerns (account resolution, database lifecycle). MCP tools and CLI handlers become thin adapters that parse input and format output.

**When to create a new operation vs. adding to a service:** Create an operation when both MCP and CLI need the same business flow that involves account resolution and service calls. Pure service calls that do not need cross-cutting orchestration stay in services.

## Alternatives Considered

### Keep duplication in handlers

Leave the orchestration logic in each MCP tool and CLI command handler. This avoids the additional layer but violates DRY — the same account-resolution and database-lifecycle boilerplate is repeated in every handler. Divergence risk grows with the number of tools. Rejected.

### Put orchestration in services

Move the orchestration into service classes themselves. This would eliminate duplication but mix domain logic (campaign CRUD, profile lookup) with infrastructure concerns (CDP port/host options, account resolution, database lifecycle). Services would need to know about connection parameters that are irrelevant to their domain responsibility. Rejected.

## Consequences

**Positive:**

- Single source of truth for business flows — a bug fix in an operation applies to both CLI and MCP
- Thinner interface adapters — MCP tools and CLI handlers focus on input parsing and output formatting
- Easier to test orchestration in isolation from interface-specific concerns
- Clear layering: interface adapters → operations → services → database/CDP

**Negative:**

- Additional layer to navigate when tracing a request from interface to database
- Operations must be kept in sync with service API changes (e.g., if `CampaignService.getStatus()` signature changes)
