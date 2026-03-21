// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

export { AppService, type AppServiceOptions } from "./app.js";
export { InstanceService, type ActionResult, type HealthChecker } from "./instance.js";
export {
  VoyagerInterceptor,
  type VoyagerFetchOptions,
  type VoyagerResponse,
  type VoyagerResponseHandler,
} from "../voyager/index.js";
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
export { EphemeralCampaignService } from "./ephemeral-campaign.js";
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
export { detectSourceType, validateSourceType } from "./source-type-registry.js";
export { buildBooleanExpression } from "./boolean-expression.js";
export { buildBasicSearchUrl } from "./url-builder.js";
export { buildSNSearchUrl } from "./sn-url-builder.js";
export {
  buildParameterisedUrl,
  getFixedUrl,
  getParameterType,
  isFixedUrlType,
  isParameterisedType,
  isSNSearchBuilderType,
  isSearchBuilderType,
} from "./url-templates.js";
export { CollectionService } from "./collection.js";
export {
  ActionExecutionError,
  AppLaunchError,
  AppNotFoundError,
  BudgetExceededError,
  CampaignExecutionError,
  CampaignTimeoutError,
  CollectionBusyError,
  CollectionError,
  ExtractionTimeoutError,
  InstanceNotRunningError,
  InvalidProfileUrlError,
  LinkedHelperNotRunningError,
  LinkedHelperUnreachableError,
  NodeIntegrationUnavailableError,
  ServiceError,
  StartInstanceError,
  UIBlockedError,
  WrongPortError,
} from "./errors.js";
