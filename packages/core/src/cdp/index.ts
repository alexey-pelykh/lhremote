// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

export { CDPClient } from "./client.js";
export { discoverTargets } from "./discovery.js";
export {
  discoverInstancePort,
  killInstanceProcesses,
} from "./instance-discovery.js";
export {
  findApp,
  resolveAppPort,
  resolveInstancePort,
  resolveLauncherPort,
  type AppRole,
  type DiscoveredApp,
  type FindAppOptions,
} from "./app-discovery.js";
export {
  scanRunningInstances,
  scanOrphans,
  reapOrphans,
  parseIdentityFromCmdline,
  type IdentitySource,
  type IdentityConfidence,
  type InstanceIdentity,
  type RunningInstance,
  type OrphanProcess,
} from "./process-inspector.js";
export {
  CDPConnectionError,
  CDPError,
  CDPEvaluationError,
  CDPTimeoutError,
} from "./errors.js";
export {
  gatherRawProcesses,
  invalidateProcessCache,
  type RawProcess,
} from "./gather-raw-processes.js";
export {
  readinessTracker,
  waitForConnectable,
  InstanceReadinessTracker,
  DEFAULT_GRACE_WINDOW_MS,
  DEFAULT_CONNECTABLE_TIMEOUT_MS,
  DEFAULT_CONNECTABLE_INTERVAL_MS,
  type InstanceReadiness,
  type WaitForConnectableOptions,
  type WaitForConnectableResult,
} from "./instance-readiness.js";
export {
  withLauncherQueue,
  DEFAULT_SETTLE_BARRIER_TIMEOUT_MS,
  type SettleType,
  type LauncherQueueSettleOptions,
} from "./launcher-queue.js";
