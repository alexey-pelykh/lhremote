import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerAllTools } from "./tools/index.js";

const require = createRequire(import.meta.url);
const { name, version } = require("../package.json") as { name: string; version: string };

/**
 * Create a configured MCP server instance with all tools registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name, version });
  registerAllTools(server);
  return server;
}
