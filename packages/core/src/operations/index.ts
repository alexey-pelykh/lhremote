// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

export type { ConnectionOptions } from "./types.js";

// Campaign CRUD
export {
  campaignGet,
  type CampaignGetInput,
  type CampaignGetOutput,
} from "./campaign-get.js";
export {
  campaignList,
  type CampaignListInput,
  type CampaignListOutput,
} from "./campaign-list.js";
export {
  campaignCreate,
  type CampaignCreateInput,
  type CampaignCreateOutput,
} from "./campaign-create.js";
export {
  campaignUpdate,
  type CampaignUpdateInput,
  type CampaignUpdateOutput,
} from "./campaign-update.js";
export {
  campaignDelete,
  type CampaignDeleteInput,
  type CampaignDeleteOutput,
} from "./campaign-delete.js";

// Campaign execution
export {
  campaignStart,
  type CampaignStartInput,
  type CampaignStartOutput,
} from "./campaign-start.js";
export {
  campaignStop,
  type CampaignStopInput,
  type CampaignStopOutput,
} from "./campaign-stop.js";
export {
  campaignRetry,
  type CampaignRetryInput,
  type CampaignRetryOutput,
} from "./campaign-retry.js";
export {
  campaignMoveNext,
  type CampaignMoveNextInput,
  type CampaignMoveNextOutput,
} from "./campaign-move-next.js";
export {
  campaignStatistics,
  type CampaignStatisticsInput,
  type CampaignStatisticsOutput,
} from "./campaign-statistics.js";
export {
  campaignStatus,
  type CampaignStatusInput,
  type CampaignStatusOutput,
} from "./campaign-status.js";

// Campaign configuration
export {
  campaignAddAction,
  type CampaignAddActionInput,
  type CampaignAddActionOutput,
} from "./campaign-add-action.js";
export {
  campaignRemoveAction,
  type CampaignRemoveActionInput,
  type CampaignRemoveActionOutput,
} from "./campaign-remove-action.js";
export {
  campaignReorderActions,
  type CampaignReorderActionsInput,
  type CampaignReorderActionsOutput,
} from "./campaign-reorder-actions.js";
export {
  campaignExport,
  type CampaignExportInput,
  type CampaignExportOutput,
} from "./campaign-export.js";

// Exclude list
export {
  campaignExcludeAdd,
  type CampaignExcludeAddInput,
  type CampaignExcludeAddOutput,
} from "./campaign-exclude-add.js";
export {
  campaignExcludeRemove,
  type CampaignExcludeRemoveInput,
  type CampaignExcludeRemoveOutput,
} from "./campaign-exclude-remove.js";
export {
  campaignExcludeList,
  type CampaignExcludeListInput,
  type CampaignExcludeListOutput,
} from "./campaign-exclude-list.js";

// Error detection
export {
  getErrors,
  type GetErrorsInput,
  type GetErrorsOutput,
} from "./get-errors.js";

// Messaging
export {
  queryMessages,
  type QueryMessagesInput,
  type QueryMessagesOutput,
} from "./query-messages.js";
export {
  checkReplies,
  type CheckRepliesInput,
  type CheckRepliesOutput,
} from "./check-replies.js";
export {
  scrapeMessagingHistory,
  type ScrapeMessagingHistoryInput,
  type ScrapeMessagingHistoryOutput,
} from "./scrape-messaging-history.js";
export {
  importPeopleFromUrls,
  type ImportPeopleFromUrlsInput,
  type ImportPeopleFromUrlsOutput,
} from "./import-people-from-urls.js";
