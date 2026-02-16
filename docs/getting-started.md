# Getting Started with lhremote

This guide walks you through a complete first-use scenario: from installation to running your first campaign.

## Prerequisites

Before you begin, make sure you have:

- **Node.js** >= 24 ([download](https://nodejs.org/))
- **LinkedHelper** desktop application installed with an active license ([linkedhelper.com](https://linkedhelper.com))
- A LinkedIn account configured in LinkedHelper

## Install lhremote

Install globally via npm:

```sh
npm install -g lhremote
```

Or run directly with npx (no install needed):

```sh
npx lhremote --help
```

## Step 1: Launch LinkedHelper

Start the LinkedHelper application. You can launch it manually from your desktop, or use lhremote:

```sh
lhremote launch-app
```

This starts LinkedHelper with remote debugging enabled so lhremote can communicate with it.

## Step 2: Find the running app

Verify that lhremote can detect LinkedHelper:

```sh
lhremote find-app
```

You should see output confirming the app was found with its CDP connection details (host and port). If you get an error, make sure LinkedHelper is running.

## Step 3: Start a LinkedHelper instance

LinkedHelper needs an active instance for a LinkedIn account. First, list available accounts:

```sh
lhremote list-accounts
```

Then start an instance. If you have a single account, no account ID is needed:

```sh
lhremote start-instance
```

If you have multiple accounts, pass the account ID from the list:

```sh
lhremote start-instance <accountId>
```

Instance startup loads LinkedIn in the background, which may take up to 45 seconds.

## Step 4: Check instance status

Confirm everything is connected:

```sh
lhremote check-status
```

This shows the connection status, running instances, and database health. Wait until the instance shows as fully initialized before proceeding.

## Step 5: Create a campaign

Campaigns define what actions to perform on target LinkedIn profiles. Create a simple "visit and extract" campaign that visits profiles and collects their data.

Save this as `my-campaign.yaml`:

```yaml
version: "1"
name: "My First Campaign"
description: "Visit profiles and extract their information"
settings:
  maxActionsPerRun: 5
actions:
  - type: VisitAndExtract
```

Then create the campaign:

```sh
lhremote campaign-create --file my-campaign.yaml
```

The output includes the new campaign's ID. Note it for the next steps.

> **Tip**: Use `lhremote describe-actions` to explore all available action types. You can filter by category (`people`, `messaging`, `engagement`, `crm`, `workflow`) or get details for a specific type with `--type <ActionType>`.

## Step 6: Import targets

Add LinkedIn profile URLs as targets for your campaign:

```sh
lhremote import-people-from-urls <campaignId> \
  --urls "https://www.linkedin.com/in/example-profile-1/" \
  --urls "https://www.linkedin.com/in/example-profile-2/"
```

For larger lists, put the URLs in a file (one per line) and use:

```sh
lhremote import-people-from-urls <campaignId> --urls-file targets.txt
```

Previously imported URLs are skipped automatically, so the command is safe to run multiple times.

## Step 7: Run the campaign

Start the campaign:

```sh
lhremote campaign-start <campaignId>
```

LinkedHelper will begin processing the target profiles according to your action chain.

## Step 8: Check campaign results

Monitor progress while the campaign runs:

```sh
lhremote campaign-status <campaignId>
```

For detailed per-action statistics:

```sh
lhremote campaign-statistics <campaignId>
```

To see individual execution results:

```sh
lhremote campaign-status <campaignId> --include-results
```

When you are done, stop the campaign:

```sh
lhremote campaign-stop <campaignId>
```

## Using lhremote with Claude Code (plugin)

The easiest way to use lhremote with Claude Code is via the plugin system. This installs the MCP server and workflow skill automatically.

### Install the plugin

From within Claude Code, add the marketplace and install:

```shell
/plugin marketplace add alexey-pelykh/lhremote
/plugin install lhremote@lhremote
```

This sets up:

- **MCP server** — Claude Code can call all lhremote tools directly
- **Workflow skill** — Claude Code learns lhremote discovery flows, campaign patterns, and error handling

### Verify the installation

Run `/plugin` and check the **Installed** tab to confirm lhremote appears. Then try asking Claude Code to interact with LinkedHelper:

```
Find LinkedHelper and check its status
```

## Using lhremote with Claude Desktop (MCP)

lhremote includes a built-in [MCP](https://modelcontextprotocol.io) server that lets AI assistants like Claude control LinkedHelper directly.

### Configure Claude Desktop

Add lhremote to your Claude Desktop configuration file (`claude_desktop_config.json`):

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

### What you can ask Claude

Once configured, Claude has access to all lhremote tools. You can ask it to:

- **"Find LinkedHelper and start an instance"** — Claude will detect the app and start an instance for your account
- **"Create a campaign that visits profiles and sends a connection request"** — Claude will build a multi-action campaign configuration
- **"Import these LinkedIn profiles into my campaign"** — provide URLs and Claude will import them
- **"Start my campaign and check the results"** — Claude will run the campaign and report on progress
- **"Check for new message replies"** — Claude will query the messaging history

Claude handles the multi-step workflows automatically, including waiting for instance startup and checking status between operations.

## Next steps

- See the full [CLI and MCP tool reference](../) for all available commands
- Use `lhremote describe-actions` to explore action types for more advanced campaigns (messaging, endorsements, InMail, and more)
- Run `lhremote --help` or `lhremote <command> --help` for detailed usage information
