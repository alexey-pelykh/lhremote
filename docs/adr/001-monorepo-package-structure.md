# ADR-001: Monorepo Package Structure

## Status

Accepted

## Context

lhremote provides automation tooling for LinkedHelper.com through two user-facing interfaces (CLI and MCP server) that share a common core of CDP communication, database access, and service orchestration logic. A key design question was how to organize the codebase: as a single package, as independent repositories, or as a structured monorepo.

The project needs to:

- Publish a single `lhremote` package to npm that bundles both the CLI and MCP server
- Keep the core automation logic (CDP client, database access, services) reusable across interfaces
- Allow independent development and testing of CLI and MCP concerns
- Support a clear dependency direction to avoid circular dependencies

## Decision

Organize as a pnpm workspace monorepo with four packages in a layered dependency graph:

```
lhremote (distribution package)
├── @lhremote/cli   (CLI interface)
└── @lhremote/mcp   (MCP server interface)
    └── @lhremote/core (shared foundation)
```

**Package responsibilities:**

| Package | Role | Dependencies |
|---------|------|-------------|
| `@lhremote/core` | CDP client, database access, services, domain types | External only (devtools-protocol, ps-list, etc.) |
| `@lhremote/mcp` | MCP server with tool definitions and Zod validation | `@lhremote/core`, `@modelcontextprotocol/sdk`, `zod` |
| `@lhremote/cli` | Commander.js CLI with command handlers | `@lhremote/core`, `commander` |
| `lhremote` | Published npm package, combines CLI + MCP binaries | `@lhremote/cli`, `@lhremote/mcp` |

**Key constraints:**

- `core` has no dependency on `cli` or `mcp` (strict upward dependency)
- `cli` and `mcp` are siblings with no dependency on each other
- `lhremote` is a thin aggregation layer with no business logic
- All packages use ESM, TypeScript 5.9, and target Node 24+

## Alternatives Considered

### Single package

All code in one package. Simpler to manage but mixes concerns — MCP SDK and Commander would both be runtime dependencies even if only one interface is used. Testing boundaries become blurred. As the tool surface grows (35+ tools/commands), a flat structure becomes harder to navigate.

### Separate repositories

Independent repos for core, CLI, and MCP. Provides hard isolation but introduces version coordination overhead, cross-repo CI complexity, and makes atomic changes across layers difficult. The packages evolve in lockstep, making the overhead unjustified.

### Two packages (core + app)

Merge CLI and MCP into a single "app" package. Reduces package count but couples two interface concerns that have different dependencies (Commander vs MCP SDK) and different testing needs. Would make it harder to add future interfaces (e.g., a REST API) without pulling in unrelated dependencies.

## Consequences

**Positive:**

- Clear separation of concerns — each package has a single responsibility
- `core` can be tested independently without interface-specific dependencies
- Adding a new interface (e.g., REST API) means adding a sibling package, not modifying existing ones
- Turbo cache works per-package, so changes to `cli` don't rebuild `mcp`
- The published `lhremote` package is a thin shell, keeping distribution simple

**Negative:**

- Four `package.json` files and `tsconfig.json` files to maintain
- pnpm workspace and Turbo configuration add infrastructure complexity
- Developers must understand the dependency graph to know where code belongs
- Cross-package TypeScript changes require rebuilding downstream packages

**Neutral:**

- pnpm workspace protocol (`workspace:^`) handles local resolution during development and is replaced with real versions at publish time
