// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

// Types (profile, messaging, instance, account, campaign — CDP types are internal)
export type {
  Account,
  ActionConfig,
  ActionErrorSummary,
  ActionPeopleCounts,
  ActionStatistics,
  CampaignActionConfig,
  CampaignActionResult,
  ActionSettings,
  ActionTargetPerson,
  Campaign,
  CampaignAction,
  CampaignConfig,
  CampaignRunResult,
  CampaignState,
  CampaignStatistics,
  CampaignStatus,
  CampaignSummary,
  CampaignUpdateConfig,
  ExcludeListEntry,
  Chat,
  ChatParticipant,
  ConversationMessages,
  ConversationThread,
  CurrentPosition,
  Education,
  ExternalId,
  ExternalIdTypeGroup,
  GetResultsOptions,
  GetStatisticsOptions,
  ImportPeopleResult,
  InstanceInfo,
  InstanceStatus,
  ListCampaignsOptions,
  Message,
  MessageStats,
  MessageSummary,
  MiniProfile,
  Position,
  Profile,
  ProfileSearchOptions,
  ProfileSearchResult,
  ProfileSummary,
  RunnerState,
  Skill,
  StartInstanceParams,
  StartInstanceResult,
} from "./types/index.js";

// Services
export {
  AccountResolutionError,
  ActionExecutionError,
  type ActionResult,
  AppLaunchError,
  AppNotFoundError,
  AppService,
  type AppServiceOptions,
  CampaignExecutionError,
  CampaignService,
  CampaignTimeoutError,
  type DatabaseContext,
  ExtractionTimeoutError,
  type InstanceDatabaseContext,
  InstanceNotRunningError,
  InstanceService,
  InvalidProfileUrlError,
  LauncherService,
  LinkedHelperNotRunningError,
  resolveAccount,
  ServiceError,
  StartInstanceError,
  startInstanceWithRecovery,
  type StartInstanceOutcome,
  checkStatus,
  type AccountInstanceStatus,
  type DatabaseStatus,
  type LauncherStatus,
  type StatusReport,
  waitForInstancePort,
  waitForInstanceShutdown,
  withDatabase,
  withInstanceDatabase,
} from "./services/index.js";

// Data access
export {
  CampaignRepository,
  DatabaseClient,
  type DatabaseClientOptions,
  discoverAllDatabases,
  discoverDatabase,
  MessageRepository,
  ProfileRepository,
} from "./db/index.js";

// Formats
export {
  CampaignFormatError,
  parseCampaignJson,
  parseCampaignYaml,
  serializeCampaignJson,
  serializeCampaignYaml,
} from "./formats/index.js";

// Data (action types catalog)
export {
  type ActionCategory,
  type ActionType,
  type ActionTypeCatalog,
  type ActionTypeInfo,
  type ConfigFieldSchema,
  getActionTypeCatalog,
  getActionTypeInfo,
} from "./data/index.js";

// Errors (DB + CDP errors can propagate through the service layer)
export {
  ActionNotFoundError,
  CampaignNotFoundError,
  ChatNotFoundError,
  DatabaseError,
  DatabaseNotFoundError,
  ExcludeListNotFoundError,
  NoNextActionError,
  ProfileNotFoundError,
} from "./db/index.js";

export {
  CDPConnectionError,
  CDPError,
  CDPEvaluationError,
  CDPTimeoutError,
  discoverInstancePort,
  discoverTargets,
  findApp,
  type DiscoveredApp,
  killInstanceProcesses,
} from "./cdp/index.js";

// Constants
export { DEFAULT_CDP_PORT } from "./constants.js";

// Utilities
export { delay, errorMessage, isCdpPort, isLoopbackAddress } from "./utils/index.js";
