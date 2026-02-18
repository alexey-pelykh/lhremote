// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

export { AppService, type AppServiceOptions } from "./app.js";
export { InstanceService, type ActionResult, type HealthChecker } from "./instance.js";
export {
  startInstanceWithRecovery,
  waitForInstancePort,
  waitForInstanceShutdown,
  type StartInstanceOutcome,
} from "./instance-lifecycle.js";
export { LauncherService } from "./launcher.js";
export {
  checkStatus,
  type AccountInstanceStatus,
  type DatabaseStatus,
  type LauncherStatus,
  type StatusReport,
} from "./status.js";

export { CampaignService } from "./campaign.js";
export {
  AccountResolutionError,
  resolveAccount,
} from "./account-resolution.js";
export {
  withDatabase,
  withInstanceDatabase,
  type DatabaseContext,
  type InstanceDatabaseContext,
} from "./instance-context.js";
export {
  ActionExecutionError,
  AppLaunchError,
  AppNotFoundError,
  CampaignExecutionError,
  CampaignTimeoutError,
  ExtractionTimeoutError,
  InstanceNotRunningError,
  InvalidProfileUrlError,
  LinkedHelperNotRunningError,
  ServiceError,
  StartInstanceError,
  UIBlockedError,
  WrongPortError,
} from "./errors.js";
