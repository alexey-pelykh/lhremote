# Copilot Review Instructions — lhremote

> Automation toolkit for LinkedHelper.com built on Chrome DevTools Protocol (CDP).

## Project Structure

pnpm monorepo with 5 packages:

| Package | Purpose |
|---------|---------|
| `packages/core` | CDP client, account/campaign services, feed parsing |
| `packages/mcp` | Model Context Protocol server exposing core as MCP tools |
| `packages/cli` | CLI entry point (`lhremote` command) |
| `packages/lhremote` | Umbrella package re-exporting core + mcp + cli |
| `packages/e2e` | E2E tests (not published, not run in CI) |

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `campaign-format.ts` |
| Classes | PascalCase | `CampaignService` |
| Functions / methods | camelCase | `checkStatus()` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_LAUNCHER_PORT` |

Flag deviations from these conventions.

## Commit Message Format

Format: `(type) scope: description`

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

Commit messages must **not** contain issue references like `(#12)` or `fixes #12`.

## Code Patterns

- All CDP communication goes through `CDPClient` — never use raw WebSocket calls.
- Prefer `async`/`await` over raw Promise chains.
- For runtime validation of external data, follow the existing approach per package: use `zod` schemas in packages that depend on it (e.g. `packages/mcp`); use established type guards elsewhere.
- Error classes extend domain-specific base errors, not generic `Error`.
- Avoid `any` — use `unknown` with narrowing or explicit types.

## What to Flag

- Direct WebSocket usage bypassing `CdpClient`.
- `any` types without justification.
- Missing error handling on CDP calls.
- Test files without assertions (empty or no-op tests).
- Duplicated helpers that exist in `@lhremote/core/testing`.
- Magic numbers or strings without named constants.
