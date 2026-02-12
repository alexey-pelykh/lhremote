# @lhremote/cli

CLI for [lhremote](https://github.com/alexey-pelykh/lhremote) — LinkedHelper automation toolkit.

This package provides a command-line interface that mirrors the full MCP tool surface. Every MCP tool has a corresponding CLI command.

Built on [`@lhremote/core`](../core).

## Installation

```bash
npm install -g @lhremote/cli
```

Or run directly with npx:

```bash
npx @lhremote/cli --help
```

## Usage

```bash
# Detect running LinkedHelper
lhremote find-app --json

# List accounts and start an instance
lhremote list-accounts --cdp-port 9222
lhremote start-instance 1

# Create and run a campaign
lhremote campaign-create --file campaign.yaml
lhremote import-people-from-urls 42 --urls-file targets.txt
lhremote campaign-start 42 --person-ids 100,101,102

# Monitor progress
lhremote campaign-status 42 --include-results
lhremote campaign-statistics 42

# Query results
lhremote query-messages --person-id 100 --json
lhremote check-replies --since 2025-01-01T00:00:00Z
```

## Commands

| Category | Commands |
|----------|----------|
| App Management | `find-app`, `launch-app`, `quit-app` |
| Account & Instance | `list-accounts`, `start-instance`, `stop-instance`, `check-status` |
| Campaigns | `campaign-list`, `campaign-create`, `campaign-get`, `campaign-export`, `campaign-update`, `campaign-delete`, `campaign-start`, `campaign-stop` |
| Campaign Status | `campaign-status`, `campaign-statistics`, `campaign-retry` |
| Campaign Actions | `campaign-add-action`, `campaign-remove-action`, `campaign-reorder-actions`, `campaign-move-next` |
| Campaign Targeting | `campaign-exclude-list`, `campaign-exclude-add`, `campaign-exclude-remove`, `import-people-from-urls` |
| Profiles & Messaging | `query-profile`, `query-profiles`, `query-messages`, `check-replies`, `scrape-messaging-history` |
| Utilities | `describe-actions` |

See the [root README](https://github.com/alexey-pelykh/lhremote#cli-usage) for full command-line usage.

## Programmatic Usage

```typescript
import { createProgram } from "@lhremote/cli";

const program = createProgram();
await program.parseAsync(process.argv);
```

## License

[AGPL-3.0-only](https://github.com/alexey-pelykh/lhremote/blob/main/LICENSE)
