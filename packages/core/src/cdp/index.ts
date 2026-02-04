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
