import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerLaunchApp } from "./launch-app.js";
import { registerListAccounts } from "./list-accounts.js";
import { registerQuitApp } from "./quit-app.js";

export function registerAllTools(server: McpServer): void {
  registerLaunchApp(server);
  registerQuitApp(server);
  registerListAccounts(server);
}
