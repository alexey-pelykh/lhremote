import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCheckStatus } from "./check-status.js";
import { registerLaunchApp } from "./launch-app.js";
import { registerListAccounts } from "./list-accounts.js";
import { registerQuitApp } from "./quit-app.js";
import { registerStartInstance } from "./start-instance.js";
import { registerStopInstance } from "./stop-instance.js";
import { registerVisitAndExtract } from "./visit-and-extract.js";

export function registerAllTools(server: McpServer): void {
  registerLaunchApp(server);
  registerQuitApp(server);
  registerListAccounts(server);
  registerStartInstance(server);
  registerStopInstance(server);
  registerVisitAndExtract(server);
  registerCheckStatus(server);
}
