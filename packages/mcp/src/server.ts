import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const require = createRequire(import.meta.url);
const { name, version } = require("../package.json") as { name: string; version: string };

/**
 * Create a configured MCP server instance.
 *
 * Tools are not registered here — they will be added in subsequent
 * issues (#10, #23, #24, #13).
 */
export function createServer(): McpServer {
  return new McpServer({ name, version });
}
