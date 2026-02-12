# lhremote MCP — Tool Surface & Workflow Guide

This skill teaches the lhremote MCP tool surface: 32 tools for automating LinkedHelper via Chrome DevTools Protocol (CDP).

## Prerequisites

LinkedHelper must be installed locally with an active license. The MCP server connects to it via CDP on a configurable port (default: 9222).

## Tool Inventory

### App Management

| Tool | Description |
|------|-------------|
| `find-app` | Detect running LinkedHelper instances and their CDP ports |
| `launch-app` | Launch LinkedHelper with remote debugging enabled |
| `quit-app` | Quit the LinkedHelper application |

### Accounts & Instances

| Tool | Description |
|------|-------------|
| `list-accounts` | List available LinkedHelper accounts (ID, LinkedIn ID, name, email) |
| `start-instance` | Start a LinkedHelper instance for a LinkedIn account |
| `stop-instance` | Stop a running LinkedHelper instance |
| `check-status` | Check connection status, running instances, and database health |
| `check-replies` | Trigger reply check on LinkedIn, return new messages (default: last 24h) |

### Campaign CRUD

| Tool | Description |
|------|-------------|
| `campaign-list` | List campaigns with summary statistics |
| `campaign-create` | Create a campaign from YAML or JSON configuration |
| `campaign-get` | Get campaign details including actions and configuration |
| `campaign-update` | Update campaign name or description |
| `campaign-delete` | Delete (archive) a campaign |
| `campaign-export` | Export campaign configuration to YAML or JSON |

### Campaign Execution

| Tool | Description |
|------|-------------|
| `campaign-start` | Start a campaign with specified target person IDs (async) |
| `campaign-stop` | Stop a running campaign |
| `campaign-status` | Check execution status and optionally include results |
| `campaign-statistics` | Get detailed execution statistics with error breakdown |
| `campaign-retry` | Retry failed persons in a campaign |
| `campaign-move-next` | Advance persons to the next action in the chain |

### Campaign Actions

| Tool | Description |
|------|-------------|
| `campaign-add-action` | Add an action to a campaign |
| `campaign-remove-action` | Remove an action from a campaign |
| `campaign-reorder-actions` | Reorder actions within a campaign |
| `describe-actions` | List available action types with schemas (use to discover what actions exist) |

### Campaign Targeting

| Tool | Description |
|------|-------------|
| `import-people-from-urls` | Import LinkedIn profile URLs into a campaign's target list (idempotent) |
| `campaign-exclude-add` | Add persons to campaign or action exclude list |
| `campaign-exclude-remove` | Remove persons from exclude list |
| `campaign-exclude-list` | View the exclude list for a campaign or action |

### Profile & Message Queries

| Tool | Description |
|------|-------------|
| `query-profile` | Look up a cached LinkedIn profile by person ID or public ID |
| `query-profiles` | Search profiles by name, headline, or company (paginated) |
| `query-messages` | Query messaging history: list conversations, read threads, or search |
| `scrape-messaging-history` | Scrape all messaging history from LinkedIn (requires active instance) |

## Workflow Patterns

### Discovery Flow

Always start here when connecting to LinkedHelper for the first time in a session:

```
find-app → list-accounts → check-status
```

1. **`find-app`** — Detect if LinkedHelper is running and get its CDP port
2. **`list-accounts`** — See available accounts (needed for targeting)
3. **`check-status`** — Verify instance health and database connectivity

If `find-app` returns nothing, use `launch-app` first.

### Instance Lifecycle

An instance must be running before any campaign or query operations:

```
launch-app → start-instance → [work] → stop-instance → quit-app
```

- `start-instance` auto-selects the account when only one exists
- Most tools require a running instance (they will error if not started)
- `stop-instance` and `quit-app` are separate — stop the instance before quitting the app

### Campaign Creation & Execution

Full workflow for creating and running a campaign:

```
describe-actions → campaign-create → import-people-from-urls → campaign-start → campaign-status / campaign-statistics
```

**Step 1 — Discover action types:**

Use `describe-actions` to see available action types and their configuration schemas before building a campaign config.

**Step 2 — Create the campaign:**

`campaign-create` accepts YAML (default) or JSON configuration:

```yaml
name: "Visit & Connect"
actions:
  - name: "Visit profiles"
    actionType: "VisitAndExtract"
    coolDown: 60000
    maxActionResultsPerIteration: 10
  - name: "Send connection request"
    actionType: "InvitePerson"
    actionSettings:
      message: "Hi {firstName}, I'd like to connect!"
```

**Step 3 — Import targets:**

Use `import-people-from-urls` with LinkedIn profile URLs. This is idempotent — re-importing the same person is a no-op.

**Step 4 — Start execution:**

`campaign-start` requires both `campaignId` and `personIds` (the internal IDs, not LinkedIn URLs). It returns immediately — execution is asynchronous.

**Step 5 — Monitor progress:**

- `campaign-status` — Real-time execution state (with optional `includeResults`)
- `campaign-statistics` — Aggregated success/error counts per action

### Campaign Action Chain Management

Campaigns contain ordered action chains. Manage them with:

- `campaign-add-action` — Append an action (use `describe-actions` to discover types)
- `campaign-remove-action` — Remove by action ID
- `campaign-reorder-actions` — Reorder by providing action IDs in desired order
- `campaign-move-next` — Advance specific persons to the next action

### Messaging Workflow

```
check-replies → query-messages
```

- `check-replies` triggers LinkedHelper to fetch new replies from LinkedIn, then returns messages since a cutoff (default: last 24 hours)
- `query-messages` searches the local database — use `personId` to filter by contact, `chatId` for a specific thread, or `search` for text search
- `scrape-messaging-history` does a full scrape of all LinkedIn messages into the local database

### Data Queries (No Campaign Needed)

Profile and message queries work against the local LinkedHelper database — no campaign execution required, but an instance must be running:

- `query-profile` — Look up by `personId` (internal) or `publicId` (LinkedIn URL slug like `jane-doe-12345`)
- `query-profiles` — Search by name/headline (`query`) or company, with `limit`/`offset` pagination

## Parameter Conventions

- **`cdpPort`**: Optional on all tools, defaults to `9222`. Only change if LinkedHelper runs on a non-default port.
- **`accountId`**: Optional when only one account exists (auto-resolved). Required when multiple accounts are configured.
- **`campaignId`** / **`actionId`** / **`personId`**: Internal LinkedHelper integer IDs (not LinkedIn public IDs).
- **`format`**: Campaign config format — `"yaml"` (default) or `"json"`.
- **`publicId`**: The LinkedIn profile URL slug (e.g., `jane-doe-12345` from `linkedin.com/in/jane-doe-12345`).

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No running LinkedHelper instances found" | App not running | Use `launch-app` |
| "Failed to connect to LinkedHelper" | Wrong CDP port or app crashed | Use `find-app` to discover correct port |
| "Instance not running" | Instance not started for account | Use `start-instance` |
| "No accounts found" / "Multiple accounts" | Account resolution failed | Use `list-accounts`, then pass explicit `accountId` |
| "Campaign not found" | Invalid campaign ID | Use `campaign-list` to find valid IDs |
| "Campaign start timed out" | LinkedHelper unresponsive | Check `check-status`, retry |

## Action Type Reference

Use `describe-actions` to get full schemas. The available action types are:

| Type | Category | Purpose |
|------|----------|---------|
| `VisitAndExtract` | people | Visit LinkedIn profile and extract data |
| `InvitePerson` | people | Send connection request |
| `MessageToPerson` | messaging | Send message to connection |
| `InMail` | messaging | Send InMail to non-connection |
| `CheckForReplies` | messaging | Check for new message replies |
| `Follow` | engagement | Follow a LinkedIn profile |
| `EndorseSkills` | engagement | Endorse skills on a profile |
| `PersonPostsLiker` | engagement | Like posts by a person |
| `FilterContactsOutOfMyNetwork` | people | Filter out non-connections |
| `RemoveFromFirstConnection` | people | Remove from first connections |
| `DataEnrichment` | crm | Enrich profile data |
| `ScrapeMessagingHistory` | messaging | Scrape messaging history |
| `Waiter` | workflow | Wait for a configured delay |
