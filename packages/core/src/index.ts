// Types (profile, instance, account — CDP types are internal)
export type {
  Account,
  CurrentPosition,
  Education,
  ExternalId,
  ExternalIdTypeGroup,
  InstanceInfo,
  InstanceStatus,
  MiniProfile,
  Position,
  Profile,
  Skill,
  StartInstanceParams,
  StartInstanceResult,
} from "./types/index.js";

// Services
export {
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
  waitForInstancePort,
} from "./services/index.js";

// Data access
export {
  DatabaseClient,
  discoverAllDatabases,
  discoverDatabase,
  ProfileRepository,
} from "./db/index.js";

// Errors (DB + CDP errors can propagate through the service layer)
export {
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
} from "./cdp/index.js";
