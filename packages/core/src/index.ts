// Types (profile, messaging, instance, account, campaign — CDP types are internal)
export type {
  Account,
  ActionConfig,
  ActionPeopleCounts,
  CampaignActionConfig,
  CampaignActionResult,
  ActionSettings,
  ActionTargetPerson,
  Campaign,
  CampaignAction,
  CampaignConfig,
  CampaignRunResult,
  CampaignState,
  CampaignStatus,
  CampaignSummary,
  Chat,
  ChatParticipant,
  ConversationMessages,
  ConversationThread,
  CurrentPosition,
  Education,
  ExternalId,
  ExternalIdTypeGroup,
  GetResultsOptions,
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
  ActionExecutionError,
  type ActionResult,
  AppLaunchError,
  AppNotFoundError,
  AppService,
  type AppServiceOptions,
  CampaignExecutionError,
  CampaignService,
  CampaignTimeoutError,
  ExtractionTimeoutError,
  extractSlug,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
  ProfileService,
  ServiceError,
  StartInstanceError,
  startInstanceWithRecovery,
  type StartInstanceOutcome,
  type VisitAndExtractOptions,
  checkStatus,
  type AccountInstanceStatus,
  type DatabaseStatus,
  type LauncherStatus,
  type StatusReport,
  waitForInstancePort,
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

// Errors (DB + CDP errors can propagate through the service layer)
export {
  CampaignNotFoundError,
  ChatNotFoundError,
  DatabaseError,
  DatabaseNotFoundError,
  ProfileNotFoundError,
} from "./db/index.js";

export {
  CDPConnectionError,
  CDPError,
  CDPEvaluationError,
  CDPTimeoutError,
  discoverInstancePort,
  findApp,
  type DiscoveredApp,
} from "./cdp/index.js";
