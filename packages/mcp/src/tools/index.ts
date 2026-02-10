import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCampaignCreate } from "./campaign-create.js";
import { registerCampaignDelete } from "./campaign-delete.js";
import { registerCampaignExport } from "./campaign-export.js";
import { registerCampaignGet } from "./campaign-get.js";
import { registerCampaignList } from "./campaign-list.js";
import { registerCampaignStart } from "./campaign-start.js";
import { registerCampaignStatus } from "./campaign-status.js";
import { registerCampaignStop } from "./campaign-stop.js";
import { registerCheckReplies } from "./check-replies.js";
import { registerCheckStatus } from "./check-status.js";
import { registerDescribeActions } from "./describe-actions.js";
import { registerFindApp } from "./find-app.js";
import { registerLaunchApp } from "./launch-app.js";
import { registerListAccounts } from "./list-accounts.js";
import { registerQuitApp } from "./quit-app.js";
import { registerStartInstance } from "./start-instance.js";
import { registerStopInstance } from "./stop-instance.js";
import { registerQueryMessages } from "./query-messages.js";
import { registerQueryProfile } from "./query-profile.js";
import { registerQueryProfiles } from "./query-profiles.js";
import { registerScrapeMessagingHistory } from "./scrape-messaging-history.js";
import { registerVisitAndExtract } from "./visit-and-extract.js";

export function registerAllTools(server: McpServer): void {
  registerCampaignCreate(server);
  registerCampaignDelete(server);
  registerCampaignExport(server);
  registerCampaignGet(server);
  registerCampaignList(server);
  registerCampaignStart(server);
  registerCampaignStatus(server);
  registerCampaignStop(server);
  registerFindApp(server);
  registerLaunchApp(server);
  registerQuitApp(server);
  registerListAccounts(server);
  registerStartInstance(server);
  registerStopInstance(server);
  registerVisitAndExtract(server);
  registerQueryMessages(server);
  registerQueryProfile(server);
  registerQueryProfiles(server);
  registerScrapeMessagingHistory(server);
  registerCheckReplies(server);
  registerCheckStatus(server);
  registerDescribeActions(server);
}
