# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.2.1] — 2026-02-16

### Fixed

- Database opened read-only in `campaign-create` and `campaign-start` operations, causing "attempt to write a readonly database" errors
- Campaign config format documentation in MCP skill showing internal field names instead of portable document format

## [0.2.0] — 2026-02-16

### Added

- `campaign-create` tool for creating campaigns from YAML/JSON definitions with action chains
- `campaign-get`, `campaign-list`, `campaign-delete` tools for campaign CRUD operations
- `campaign-export` tool for exporting campaigns to YAML/JSON format
- `campaign-status` tool for querying campaign execution state
- `campaign-start` and `campaign-stop` tools for controlling campaign execution
- `campaign-update` tool for modifying existing campaigns
- `campaign-retry` tool for retrying failed campaign actions
- `campaign-move-next` tool for advancing campaign queue position
- `campaign-statistics` tool for campaign execution metrics
- `import-people-from-urls` tool for bulk-importing LinkedIn profiles into campaigns
- `campaign-add-action`, `campaign-remove-action`, `campaign-reorder-actions` tools for managing campaign action chains
- `campaign-exclude-list`, `campaign-exclude-add`, `campaign-exclude-remove` tools for campaign-action-level exclusion management
- `query-messages` tool for searching LinkedIn messaging history
- `scrape-messaging-history` tool for extracting full conversation threads
- `check-replies` tool for detecting new message replies
- `query-profile` tool for looking up profile data by URL or slug
- `query-profiles` tool for searching across stored profiles
- `describe-actions` tool for listing available LinkedHelper action types with configuration schemas
- `find-app` tool for detecting running LinkedHelper instances
- Campaign YAML/JSON format for portable campaign definitions
- Campaign database repository with CRUD and queue reset operations
- CampaignService for campaign lifecycle and execution management
- Action execution service for running LinkedHelper actions programmatically
- Action types catalog with advanced configuration schemas for all LinkedHelper action types
- `MessageRepository` for conversation and message database access
- `CampaignFormatError` integrated into domain error hierarchy
- URL validation for `navigateToProfile` to reject malformed LinkedIn URLs
- URL scheme validation in `CDPClient.navigate()` to reject non-HTTP(S) schemes
- Security warnings for `allowRemote` CDP parameter
- Claude Code plugin with `lhremote-mcp` skill for IDE integration
- SPDX license headers on all source files
- ESLint rule to enforce SPDX license headers on new files
- Dependency license compatibility check in CI
- CODEOWNERS for security-sensitive files
- Issue templates for bug reports and feature requests
- Dependabot configuration for automated dependency updates
- CONTRIBUTING guide with development setup instructions
- Getting started guide
- Architecture Decision Records (ADRs)
- Security documentation for localhost trust model, loopback validation, and MCP trust model
- npm provenance attestation for release publishing
- GitHub Pages documentation site built via pandoc on every CI run
- Test coverage reporting with Codecov integration and coverage thresholds

### Changed

- Replaced `better-sqlite3` with Node.js built-in `node:sqlite` module
- Extracted operations layer for 21 MCP/CLI tools, reducing duplication between CLI and MCP
- Decomposed `CampaignRepository` into focused repositories
- Enriched error reporting in `checkStatus` and CDP reconnection
- Exported `WrongPortError` from public API
- Pinned GitHub Actions to commit SHAs for supply-chain security
- Added `timeout-minutes` to all CI workflow jobs
- Moved E2E tests out of core to dedicated package
- Exported `DEFAULT_CDP_PORT` constant for consistent usage across packages
- Converted root devDependencies to pnpm workspace catalog refs
- Added `fail-fast: false` to CI matrix strategy
- Pinned npm version in release workflow
- Added license-check to release validation job

### Fixed

- Bare `parseInt` usage on `--max-results` CLI option (now uses explicit radix)
- Removed unused options from `launch-app`/`quit-app` CLI commands
- Windows compatibility for pnpm execution in CI scripts
- Explicit timer advancement for polling tests
- LIKE wildcard escaping for search queries
- Pagination for merged multi-database results in `query-profiles`

### Removed

- `visit-and-extract` tool and `ProfileService` — replaced by `query-profile` and `query-profiles` for data access, and campaign tools for automation

## [0.1.0] — 2026-02-04

### Added

- Unified `lhremote` meta-package combining CLI and MCP server into a single `lhremote` command with `mcp` subcommand
- `visit-and-extract` tool for visiting LinkedIn profiles and extracting structured data (name, positions, education, skills, emails)
- `check-status` health check tool for verifying LinkedHelper connection, running instances, and database state
- `start-instance` and `stop-instance` tools for managing LinkedHelper instances per LinkedIn account
- `launch-app`, `quit-app`, and `list-accounts` tools for application and account management
- MCP server with stdio transport for integration with Claude Desktop and other MCP clients
- CLI with human-readable and JSON output modes
- CDP client with WebSocket transport and target discovery
- SQLite database client for read-only access to LinkedHelper profile data
- Service layer for app lifecycle, launcher communication, instance management, and profile extraction
- E2E test infrastructure with real LinkedHelper integration
- Unit and integration test suites with mocked CDP protocol and headless Chromium

### Fixed

- Parallelized CDP discovery and hardened E2E test reliability
