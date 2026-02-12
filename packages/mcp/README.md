# @lhremote/mcp

MCP server for [lhremote](https://github.com/alexey-pelykh/lhremote) — LinkedHelper automation toolkit.

This package exposes the full LinkedHelper automation surface as a [Model Context Protocol](https://modelcontextprotocol.io) server. AI assistants (Claude, etc.) connect over stdio and use the 32 registered tools to control LinkedHelper.

Built on [`@lhremote/core`](../core).

## Installation

```bash
npm install @lhremote/mcp
```

## Usage with Claude Desktop

Add to `claude_desktop_config.json`:

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

## Programmatic Usage

```typescript
import { createServer } from "@lhremote/mcp";

const server = createServer();
// server is a fully configured McpServer with all tools registered
```

Or start the stdio transport directly:

```typescript
import { runStdioServer } from "@lhremote/mcp/stdio";

await runStdioServer();
```

## Registered Tools

| Category | Tools |
|----------|-------|
| App Management | `find-app`, `launch-app`, `quit-app` |
| Account & Instance | `list-accounts`, `start-instance`, `stop-instance`, `check-status` |
| Campaigns | `campaign-list`, `campaign-create`, `campaign-get`, `campaign-export`, `campaign-update`, `campaign-delete`, `campaign-start`, `campaign-stop` |
| Campaign Status | `campaign-status`, `campaign-statistics`, `campaign-retry` |
| Campaign Actions | `campaign-add-action`, `campaign-remove-action`, `campaign-reorder-actions`, `campaign-move-next` |
| Campaign Targeting | `campaign-exclude-list`, `campaign-exclude-add`, `campaign-exclude-remove`, `import-people-from-urls` |
| Profiles & Messaging | `query-profile`, `query-profiles`, `query-messages`, `check-replies`, `scrape-messaging-history` |
| Utilities | `describe-actions` |

See the [root README](https://github.com/alexey-pelykh/lhremote#mcp-tools) for parameter details on each tool.

## Exports

| Export | Description |
|--------|-------------|
| `createServer()` | Create a configured `McpServer` with all tools registered |
| `runStdioServer()` | Start the MCP server on stdio (from `@lhremote/mcp/stdio`) |

## License

[AGPL-3.0-only](https://github.com/alexey-pelykh/lhremote/blob/main/LICENSE)
