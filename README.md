# lhremote: LinkedHelper Automation Toolkit

[![CI](https://github.com/alexey-pelykh/lhremote/actions/workflows/ci.yml/badge.svg)](https://github.com/alexey-pelykh/lhremote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/alexey-pelykh/lhremote/graph/badge.svg)](https://codecov.io/gh/alexey-pelykh/lhremote)
[![npm version](https://img.shields.io/npm/v/lhremote?logo=npm)](https://www.npmjs.com/package/lhremote)
[![npm downloads](https://img.shields.io/npm/dm/lhremote?logo=npm)](https://www.npmjs.com/package/lhremote)
[![GitHub Repo stars](https://img.shields.io/github/stars/alexey-pelykh/lhremote?style=flat&logo=github)](https://github.com/alexey-pelykh/lhremote)
[![License](https://img.shields.io/github/license/alexey-pelykh/lhremote)](LICENSE)

CLI and MCP server for [LinkedHelper](https://linkedhelper.com) automation.

This project is brought to you by [Alexey Pelykh](https://github.com/alexey-pelykh).

## What It Does

lhremote lets AI assistants (Claude, etc.) control LinkedHelper through the [Model Context Protocol](https://modelcontextprotocol.io). It can:

- **App management** — detect, launch, and quit LinkedHelper instances
- **Account & instance control** — list accounts, start/stop instances, check status
- **Campaign automation** — create, configure, start, stop, and monitor campaigns with full action-chain management
- **People import** — import LinkedIn profile URLs into campaign target lists
- **Profile queries** — look up and search cached LinkedIn profiles from the local database
- **Messaging** — query messaging history, check for new replies, scrape conversations from LinkedIn
- **Action discovery** — list available LinkedHelper action types with configuration schemas

## Prerequisites

- **Node.js** >= 24
- **LinkedHelper** desktop application (requires a paid subscription)

## Installation

```sh
npm install -g lhremote
```

Or run directly with npx:

```sh
npx lhremote --help
```

## Usage with Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
    "mcpServers": {
        "lhremote": {
            "command": "npx",
            "args": ["lhremote", "mcp"]
        }
    }
}
```

Once configured, Claude can use all 32 tools directly. A typical workflow:

1. **`find-app`** — Detect a running LinkedHelper instance (or **`launch-app`** to start one)
2. **`list-accounts`** — See available LinkedIn accounts
3. **`start-instance`** — Start an instance for an account
4. **`describe-actions`** — Explore available action types
5. **`campaign-create`** — Create a campaign from YAML/JSON configuration
6. **`import-people-from-urls`** — Import target LinkedIn profiles into the campaign
7. **`campaign-start`** — Run the campaign
8. **`campaign-status`** / **`campaign-statistics`** — Monitor progress
9. **`query-messages`** / **`check-replies`** — Review messaging results

## CLI Usage

The `lhremote` command provides the same functionality as the MCP server. Every MCP tool has a corresponding CLI command.

### App Management

```sh
lhremote find-app [--json]
lhremote launch-app [--cdp-port <port>]
lhremote quit-app [--cdp-port <port>]
```

### Account & Instance

```sh
lhremote list-accounts [--cdp-port <port>] [--json]
lhremote start-instance <accountId> [--cdp-port <port>]
lhremote stop-instance <accountId> [--cdp-port <port>]
lhremote check-status [--cdp-port <port>] [--json]
```

### Campaigns

```sh
lhremote campaign-list [--include-archived] [--json]
lhremote campaign-create --file <path> | --yaml <config> | --json-input <config> [--cdp-port <port>] [--json]
lhremote campaign-get <campaignId> [--cdp-port <port>] [--json]
lhremote campaign-export <campaignId> [--format yaml|json] [--output <path>] [--cdp-port <port>]
lhremote campaign-update <campaignId> [--name <name>] [--description <text>] [--clear-description] [--cdp-port <port>] [--json]
lhremote campaign-delete <campaignId> [--cdp-port <port>] [--json]
lhremote campaign-start <campaignId> [--person-ids <ids>] [--person-ids-file <path>] [--cdp-port <port>] [--json]
lhremote campaign-stop <campaignId> [--cdp-port <port>] [--json]
lhremote campaign-status <campaignId> [--include-results] [--limit <n>] [--cdp-port <port>] [--json]
lhremote campaign-statistics <campaignId> [--action-id <id>] [--max-errors <n>] [--cdp-port <port>] [--json]
lhremote campaign-retry <campaignId> [--person-ids <ids>] [--person-ids-file <path>] [--cdp-port <port>] [--json]
```

### Campaign Actions

```sh
lhremote campaign-add-action <campaignId> --name <name> --action-type <type> [--description <text>] [--cool-down <ms>] [--max-results <n>] [--action-settings <json>] [--cdp-port <port>] [--json]
lhremote campaign-remove-action <campaignId> <actionId> [--cdp-port <port>] [--json]
lhremote campaign-reorder-actions <campaignId> --action-ids <ids> [--cdp-port <port>] [--json]
lhremote campaign-move-next <campaignId> <actionId> [--person-ids <ids>] [--person-ids-file <path>] [--cdp-port <port>] [--json]
```

### Campaign Targeting

```sh
lhremote campaign-exclude-list <campaignId> [--action-id <id>] [--cdp-port <port>] [--json]
lhremote campaign-exclude-add <campaignId> --person-ids <ids> | --person-ids-file <path> [--action-id <id>] [--cdp-port <port>] [--json]
lhremote campaign-exclude-remove <campaignId> --person-ids <ids> | --person-ids-file <path> [--action-id <id>] [--cdp-port <port>] [--json]
lhremote import-people-from-urls <campaignId> --urls <urls> | --urls-file <path> [--cdp-port <port>] [--json]
```

### Profiles & Messaging

```sh
lhremote query-profile --person-id <id> | --public-id <slug> [--json]
lhremote query-profiles [--query <text>] [--company <name>] [--limit <n>] [--offset <n>] [--json]
lhremote query-messages [--person-id <id>] [--chat-id <id>] [--search <text>] [--limit <n>] [--offset <n>] [--json]
lhremote check-replies [--since <timestamp>] [--cdp-port <port>] [--json]
lhremote scrape-messaging-history [--cdp-port <port>] [--json]
```

### Utilities

```sh
lhremote describe-actions [--category <category>] [--type <type>] [--json]
```

## MCP Tools

### App Management

#### `find-app`

Detect running LinkedHelper application instances and their CDP connection details.

*No parameters.*

#### `launch-app`

Launch the LinkedHelper application with remote debugging enabled.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cdpPort` | number | No | auto-select | CDP port to use |

#### `quit-app`

Quit the LinkedHelper application.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cdpPort` | number | No | 9222 | CDP port |

### Account & Instance

#### `list-accounts`

List available LinkedHelper accounts. Returns account ID, LinkedIn ID, name, and email for each account.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cdpPort` | number | No | 9222 | CDP port |

#### `start-instance`

Start a LinkedHelper instance for a LinkedIn account.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `accountId` | number | No | auto-select if single account | Account ID |
| `cdpPort` | number | No | 9222 | CDP port |

#### `stop-instance`

Stop a running LinkedHelper instance.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `accountId` | number | No | auto-select if single account | Account ID |
| `cdpPort` | number | No | 9222 | CDP port |

#### `check-status`

Check LinkedHelper connection status, running instances, and database health.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cdpPort` | number | No | 9222 | CDP port |

### Campaigns

#### `campaign-list`

List existing campaigns with summary statistics.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `includeArchived` | boolean | No | false | Include archived campaigns |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-create`

Create a new campaign from YAML or JSON configuration. Provide exactly one of `yamlConfig` or `jsonConfig`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `yamlConfig` | string | No | — | YAML campaign configuration |
| `jsonConfig` | string | No | — | JSON campaign configuration |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-get`

Get detailed campaign information including action chain.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-export`

Export campaign configuration as YAML or JSON.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `format` | string | No | yaml | Export format (`yaml` or `json`) |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-update`

Update a campaign's name and/or description.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `name` | string | No | — | New campaign name |
| `description` | string | No | — | New description (empty string to clear) |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-delete`

Delete (archive) a campaign.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-start`

Start a campaign with specified target persons.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `personIds` | number[] | No | — | Person IDs to target |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-stop`

Stop a running campaign.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-status`

Check campaign execution status and results.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `includeResults` | boolean | No | false | Include execution results |
| `limit` | number | No | 20 | Max results to return |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-statistics`

Get per-action statistics for a campaign.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `actionId` | number | No | — | Filter to a specific action |
| `maxErrors` | number | No | 5 | Max top errors per action |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-retry`

Reset specified people for re-run in a campaign.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `personIds` | number[] | No | — | Person IDs to retry |
| `cdpPort` | number | No | 9222 | CDP port |

### Campaign Actions

#### `campaign-add-action`

Add a new action to a campaign's action chain. Use `describe-actions` to explore available action types.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `name` | string | Yes | — | Display name for the action |
| `actionType` | string | Yes | — | Action type (e.g., `VisitAndExtract`, `MessageToPerson`) |
| `description` | string | No | — | Action description |
| `coolDown` | number | No | — | Milliseconds between executions |
| `maxResults` | number | No | — | Max results per iteration (-1 for unlimited) |
| `actionSettings` | object | No | — | Action-specific settings |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-remove-action`

Remove an action from a campaign's action chain.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `actionId` | number | Yes | — | Action ID to remove |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-reorder-actions`

Reorder actions in a campaign's action chain.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `actionIds` | number[] | Yes | — | Action IDs in desired order |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-move-next`

Move people from one action to the next in a campaign.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `actionId` | number | Yes | — | Action ID to move people from |
| `personIds` | number[] | No | — | Person IDs to move |
| `cdpPort` | number | No | 9222 | CDP port |

### Campaign Targeting

#### `campaign-exclude-list`

View the exclude list for a campaign or action.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `actionId` | number | No | — | Action ID (for action-level list) |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-exclude-add`

Add people to a campaign or action exclude list.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `personIds` | number[] | Yes | — | Person IDs to exclude |
| `actionId` | number | No | — | Action ID (for action-level list) |
| `cdpPort` | number | No | 9222 | CDP port |

#### `campaign-exclude-remove`

Remove people from a campaign or action exclude list.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `personIds` | number[] | Yes | — | Person IDs to remove from exclude list |
| `actionId` | number | No | — | Action ID (for action-level list) |
| `cdpPort` | number | No | 9222 | CDP port |

#### `import-people-from-urls`

Import LinkedIn profile URLs into a campaign action target list. Idempotent — previously imported URLs are skipped.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `campaignId` | number | Yes | — | Campaign ID |
| `urls` | string[] | Yes | — | LinkedIn profile URLs |
| `cdpPort` | number | No | 9222 | CDP port |

### Profiles & Messaging

#### `query-profile`

Look up a cached LinkedIn profile from the local database by person ID or public ID.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `personId` | number | No | — | Internal person ID |
| `publicId` | string | No | — | LinkedIn public ID (URL slug) |

#### `query-profiles`

Search for profiles in the local database with name, headline, or company filters.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | No | — | Search name or headline |
| `company` | string | No | — | Filter by company |
| `limit` | number | No | 20 | Max results |
| `offset` | number | No | 0 | Pagination offset |

#### `query-messages`

Query messaging history from the local database.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `personId` | number | No | — | Filter by person ID |
| `chatId` | number | No | — | Show specific conversation thread |
| `search` | string | No | — | Search message text |
| `limit` | number | No | 20 | Max results |
| `offset` | number | No | 0 | Pagination offset |

#### `check-replies`

Check for new message replies from LinkedIn.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `since` | string | No | — | Only show replies after this ISO timestamp |
| `cdpPort` | number | No | 9222 | CDP port |

#### `scrape-messaging-history`

Scrape all messaging history from LinkedIn into the local database. This is a long-running operation that navigates LinkedIn's messaging interface.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cdpPort` | number | No | 9222 | CDP port |

### Utilities

#### `describe-actions`

List available LinkedHelper action types with descriptions and configuration schemas.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `category` | string | No | — | Filter by category (`people`, `messaging`, `engagement`, `crm`, `workflow`) |
| `actionType` | string | No | — | Get details for a specific action type |

## Known Limitations

- **Platform support**: LinkedHelper runs on macOS, Windows, and Linux. Binary paths are detected automatically but can be overridden with the `LINKEDHELPER_PATH` environment variable.
- **Instance startup time**: Starting an instance loads LinkedIn, which may take up to 45 seconds.
- **Profile data is cached**: `query-profile` and `query-profiles` search the local LinkedHelper database. Profiles must have been visited or imported by LinkedHelper to appear in results.
- **Messaging scrape is slow**: `scrape-messaging-history` navigates LinkedIn's messaging UI and can take several minutes depending on conversation volume.

## Troubleshooting

### LinkedHelper is not running

**Error**: `LinkedHelper is not running (no CDP endpoint at port 9222)`

**Solution**: Use `launch-app` to start LinkedHelper, or start it manually. lhremote communicates with LinkedHelper via the Chrome DevTools Protocol (CDP), which requires the application to be running.

### Application binary not found

**Error**: `LinkedHelper application binary not found. Set LINKEDHELPER_PATH to override.`

**Solution**: Install LinkedHelper from [linkedhelper.com](https://linkedhelper.com). If installed in a non-standard location, set the `LINKEDHELPER_PATH` environment variable to the binary path.

### No accounts found

**Error**: `No accounts found.`

**Solution**: Open LinkedHelper and configure at least one LinkedIn account before using lhremote.

### Multiple accounts found

**Error**: `Multiple accounts found. Specify accountId. Use list-accounts to see available accounts.`

**Solution**: Use `list-accounts` to see available accounts, then pass the desired `accountId` to `start-instance`, `stop-instance`, or other tools.

### No instance running

**Error**: `No LinkedHelper instance is running. Use start-instance first.`

**Solution**: Run `start-instance` before using campaign or messaging tools. An instance must be running to interact with LinkedIn.

### Instance initialization timeout

**Error**: `Instance started but failed to initialize within timeout.`

**Solution**: The instance was started but took too long to finish loading. This can happen on slow connections. Try again; the instance may still be starting in the background. Use `check-status` to verify.

### Database not found

**Error**: `No database found for account`

**Solution**: The LinkedHelper database file is missing for the specified account. Ensure the account has been used at least once in LinkedHelper so that a local database has been created.

## Disclaimer

`lhremote` is an **independent project** not affiliated with, endorsed by, or officially connected to:

- **LinkedIn** or LinkedIn Corporation
- **LinkedHelper** or its parent company

LinkedIn is a trademark of LinkedIn Corporation. LinkedHelper is a trademark of its respective owner.

## Purpose

This project enables **interoperability** between automation tools and LinkedHelper, as permitted under DMCA § 1201(f). Implementation is based on publicly observable behavior (Chrome DevTools Protocol) without access to protected source code.

## What This Project Does NOT Do

- Circumvent copy protection or licensing
- Bypass LinkedHelper authentication
- Enable use without a valid LinkedHelper subscription
- Provide access to LinkedIn without LinkedHelper

## User Responsibility

Use of `lhremote` requires a valid LinkedHelper subscription and is subject to LinkedHelper's and LinkedIn's terms of service. Users accept all responsibility for compliance.

## Ethical Use

This tool is for **legitimate productivity**. Do NOT use for spam, scraping at scale, or harassment.

## License

[AGPL-3.0-only](LICENSE) — For commercial licensing, contact the maintainer.
