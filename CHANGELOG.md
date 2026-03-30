# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.8.0] — 2026-03-22

### Added

- `visit-profile` tool for visiting a LinkedIn profile as a standalone action
- `get-feed` tool for fetching the LinkedIn home feed
- `get-profile-activity` tool for viewing a profile's recent activity
- `search-posts` tool for searching LinkedIn posts
- `get-post` tool for retrieving single post details with comments
- `get-post-stats` tool for post engagement statistics
- `get-post-engagers` tool for listing users who engaged with a post
- `react-to-post` tool for reacting to LinkedIn posts
- `comment-on-post` tool for commenting on LinkedIn posts
- `like-person-posts` tool for liking a person's recent posts
- `message-person` tool for sending direct messages
- `send-invite` tool for sending connection invitations
- `send-inmail` tool for sending InMail messages
- `endorse-skills` tool for endorsing a person's LinkedIn skills
- `enrich-profile` tool for enriching stored profile data via VisitAndExtract
- `follow-person` tool for following LinkedIn profiles
- `remove-connection` tool for removing LinkedIn connections
- `get-action-budget` tool for querying daily action budget usage
- `get-throttle-status` tool for checking LinkedIn throttle status
- `campaign-erase` tool for permanent campaign deletion (bypasses soft delete)
- `dismiss-errors` tool for clearing instance UI error popups
- Instance UI popup detection via CDP with visibility filtering and cross-strategy deduplication
- Health checker integration for automatic instance popup detection
- Ephemeral campaign service for executing individual actions without persistent campaign setup
- DOM automation primitives for LinkedIn WebView interaction
- Voyager API interceptor for capturing LinkedIn API responses
- LinkedIn CSS selectors registry for robust element targeting

### Changed

- `campaign-delete` gained `hard` option for permanent deletion alongside the default soft delete
- `get-errors` enhanced to include instance UI popups
- `query-profile` gained URL-based lookup support

### Fixed

- Null school handling in profile data extraction
- Poll `canCollect` after navigation instead of single check
- Bound poll delay to remaining deadline time

## [0.7.0] — 2026-03-20

### Added

- `build-linkedin-url` tool for constructing LinkedIn URLs from entity types, reference data, and search parameters
- `resolve-linkedin-entity` tool for resolving LinkedIn entity identifiers to names and metadata
- `list-linkedin-reference-data` tool for listing LinkedIn reference data (industries, regions, company sizes, etc.)
- LinkedIn URL builder service with boolean expression support for complex search queries
- LinkedIn search URL builder for Sales Navigator advanced searches

### Fixed

- Navigate LinkedIn webview to source URL before collection
- Respect `force` flag in `launch-app` when a connectable app already exists
- Resolve Node.js execution context for launcher CDP injection

## [0.6.0] — 2026-03-17

### Added

- `list-collections` tool for listing LinkedHelper collections (Lists)
- `create-collection` and `delete-collection` tools for collection CRUD operations
- `add-people-to-collection` and `remove-people-from-collection` tools for managing collection membership
- `collect-people` tool for collecting people from LinkedIn pages into campaigns
- `import-people-from-collection` tool for importing collection members into a campaign
- `CollectionService` for LinkedHelper collection management via IPC
- Source type registry for LinkedIn page URL detection and classification

## [0.5.0] — 2026-03-17

### Added

- `LinkedHelperUnreachableError` to distinguish "LH not running" from "LH running but CDP unreachable"
- Proactive process conflict detection in `AppService.launch()` — prevents spawning duplicate LinkedHelper instances
- `force` option for `AppService.launch()` and `launch-app` MCP tool to kill stale processes before relaunching
- Process-level detection in `checkStatus()` when launcher is unreachable — reports discovered PIDs in `StatusReport`
- `LauncherService.connect()` now throws `LinkedHelperUnreachableError` (with PIDs) instead of the misleading `LinkedHelperNotRunningError` when LH processes are detected
- MCP error mapping for `LinkedHelperUnreachableError` with actionable restart guidance

## [0.4.0] — 2026-03-03

### Added

- `query-profiles-bulk` tool for batch profile lookups by multiple person IDs
- `campaign-remove-people` tool to remove targets from a campaign
- `campaign-update-action` tool for updating action settings
- `campaign-list-people` tool to enumerate campaign targets
- `includePositions` option for `query-profile` to include career history (positions)
- Profile data included in `campaign-status` results

### Fixed

- `scrape-messaging-history` now requires `personIds` parameter — previously crashed with empty config when no person IDs were provided
- Runtime validation for empty `personIds` at the core operation boundary

## [0.3.0] — 2026-03-02

### Added

- `includeHistory` option for `query-profiles` to search across past positions (company history), not just current employer
- Automatic chunking for `import-people-from-urls` — large URL sets are split into batches of 200 with aggregated results
- Rate limiting guidance section in Getting Started guide with recommended daily limits for VisitAndExtract campaigns
- Rate limiting note in `VisitAndExtract` action type description (surfaced by `describe-actions`)

### Changed

- Replaced SHA-pinned GitHub Actions with major version tags for readability and reduced Dependabot noise
- Added MCP Registry metadata for tool discoverability

## [0.2.2] — 2026-02-19

### Added

- Detection and surfacing of LinkedHelper UI errors, dialogs, and blocking popups
- Claude Code plugin packaging for IDE integration

### Fixed

- Missing `created_at` in `moveToNextAction` INSERT causing database errors
- Test fixture schema alignment with real LinkedHelper database

### Changed

- Removed unused `InstanceService.navigateToProfile` method
- Removed unused `InstanceService.triggerExtraction` method

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
