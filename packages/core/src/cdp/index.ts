// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

export { CDPClient } from "./client.js";
export { discoverTargets } from "./discovery.js";
export {
  discoverInstancePort,
  killInstanceProcesses,
} from "./instance-discovery.js";
export { findApp, type DiscoveredApp } from "./app-discovery.js";
export {
  CDPConnectionError,
  CDPError,
  CDPEvaluationError,
  CDPTimeoutError,
} from "./errors.js";
