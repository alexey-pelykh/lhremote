# @insoftex/lhremote-mcp

MCP server for [lhremote](https://github.com/insoftex-company/insoftex-lhremote) — LinkedHelper automation toolkit.

This package exposes the full LinkedHelper automation surface as a [Model Context Protocol](https://modelcontextprotocol.io) server. AI assistants (Claude, etc.) connect over stdio and use the 78 registered tools to control LinkedHelper.

Built on [`@insoftex/lhremote-core`](../core).

## Installation

```bash
npm install @insoftex/lhremote-mcp
```

## Usage with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lhremote": {
      "command": "npx",
      "args": ["@insoftex/lhremote", "mcp"]
    }
  }
}
```

## Programmatic Usage

```typescript
import { createServer } from "@insoftex/lhremote-mcp";

const server = createServer();
// server is a fully configured McpServer with all tools registered
```

Or start the stdio transport directly:

```typescript
import { runStdioServer } from "@insoftex/lhremote-mcp/stdio";

await runStdioServer();
```

## Registered Tools

| Category | Tools |
|----------|-------|
| App Management | `find-app`, `launch-app`, `quit-app` |
| Account & Instance | `list-accounts`, `start-instance`, `stop-instance`, `check-status` |
| Campaigns | `campaign-list`, `campaign-create`, `campaign-get`, `campaign-export`, `campaign-update`, `campaign-delete`, `campaign-erase`, `campaign-start`, `campaign-stop` |
| Campaign Status | `campaign-status`, `campaign-statistics`, `campaign-retry` |
| Campaign Actions | `campaign-add-action`, `campaign-remove-action`, `campaign-update-action`, `campaign-reorder-actions`, `campaign-move-next` |
| Campaign Targeting | `campaign-exclude-list`, `campaign-exclude-add`, `campaign-exclude-remove`, `campaign-list-people`, `campaign-remove-people`, `import-people-from-urls`, `collect-people` |
| Collections | `list-collections`, `create-collection`, `delete-collection`, `add-people-to-collection`, `remove-people-from-collection`, `import-people-from-collection` |
| LinkedIn Actions | `visit-profile`, `endorse-skills`, `enrich-profile`, `follow-person`, `like-person-posts`, `message-person`, `send-invite`, `send-inmail`, `remove-connection` |
| Feed & Posts | `get-feed`, `get-post`, `get-post-stats`, `get-post-engagers`, `get-profile-activity`, `search-posts`, `comment-on-post`, `react-to-post` |
| LinkedIn Search & Reference | `build-linkedin-url`, `resolve-linkedin-entity`, `list-linkedin-reference-data` |
| Profiles & Messaging | `query-profile`, `query-profiles`, `query-profiles-bulk`, `query-messages`, `check-replies`, `scrape-messaging-history` |
| Utilities | `describe-actions`, `get-errors`, `dismiss-errors`, `get-action-budget`, `get-throttle-status` |

See the [root README](https://github.com/insoftex-company/insoftex-lhremote#mcp-tools) for parameter details on each tool, and the [MCP Agent Capabilities guide](../../docs/mcp-agent-capabilities.md) for recommended agent workflows.

## Exports

| Export | Description |
|--------|-------------|
| `createServer()` | Create a configured `McpServer` with all tools registered |
| `runStdioServer()` | Start the MCP server on stdio (from `@insoftex/lhremote-mcp/stdio`) |

## License

[AGPL-3.0-only](https://github.com/insoftex-company/insoftex-lhremote/blob/main/LICENSE)
