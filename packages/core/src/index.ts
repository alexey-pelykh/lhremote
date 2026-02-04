// Types (profile, messaging, instance, account — CDP types are internal)
export type {
  Account,
  Chat,
  ChatParticipant,
  ConversationThread,
  CurrentPosition,
  Education,
  ExternalId,
  ExternalIdTypeGroup,
  InstanceInfo,
  InstanceStatus,
  Message,
  MessageStats,
  MessageSummary,
  MiniProfile,
  Position,
  Profile,
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
  DatabaseClient,
  discoverAllDatabases,
  discoverDatabase,
  MessageRepository,
  ProfileRepository,
} from "./db/index.js";

// Errors (DB + CDP errors can propagate through the service layer)
export {
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
