/**
 * Base class for all service-layer errors.
 */
export class ServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ServiceError";
  }
}

/**
 * Thrown when the LinkedHelper application binary cannot be found
 * at the expected platform-specific location.
 */
export class AppNotFoundError extends ServiceError {
  constructor(message?: string) {
    super(
      message ?? "LinkedHelper application binary not found. Set LINKEDHELPER_PATH to override.",
    );
    this.name = "AppNotFoundError";
  }
}

/**
 * Thrown when the LinkedHelper application fails to start.
 */
export class AppLaunchError extends ServiceError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppLaunchError";
  }
}

/**
 * Thrown when the LinkedHelper launcher is not reachable via CDP.
 */
export class LinkedHelperNotRunningError extends ServiceError {
  constructor(port: number) {
    super(
      `LinkedHelper is not running (no CDP endpoint at port ${String(port)})`,
    );
    this.name = "LinkedHelperNotRunningError";
  }
}

/**
 * Thrown when starting a LinkedHelper instance fails.
 */
export class StartInstanceError extends ServiceError {
  constructor(accountId: number, reason?: string) {
    super(
      `Failed to start instance for account ${String(accountId)}${reason ? `: ${reason}` : ""}`,
    );
    this.name = "StartInstanceError";
  }
}

/**
 * Thrown when an expected LinkedHelper instance is not running.
 */
export class InstanceNotRunningError extends ServiceError {
  constructor(message?: string) {
    super(message ?? "Instance not running");
    this.name = "InstanceNotRunningError";
  }
}

/**
 * Thrown when the CDP port appears to belong to a LinkedHelper instance
 * (webview) rather than the launcher process.
 */
export class WrongPortError extends ServiceError {
  constructor(port: number) {
    super(
      `CDP port ${String(port)} appears to be a LinkedHelper instance, not the launcher. ` +
        `Use the launcher port instead (default: 9222).`,
    );
    this.name = "WrongPortError";
  }
}

/**
 * Thrown when a LinkedHelper action execution fails.
 */
export class ActionExecutionError extends ServiceError {
  /** The action type that was attempted (e.g., 'MessageToPerson'). */
  readonly actionType: string;

  constructor(actionType: string, message?: string, options?: ErrorOptions) {
    super(
      message ?? `Action '${actionType}' failed`,
      options,
    );
    this.name = "ActionExecutionError";
    this.actionType = actionType;
  }
}

/**
 * Thrown when profile extraction times out waiting for data
 * to appear in the database.
 */
export class ExtractionTimeoutError extends ServiceError {
  constructor(profileUrl: string, timeoutMs: number) {
    super(
      `Profile extraction timed out after ${String(timeoutMs)}ms for ${profileUrl}`,
    );
    this.name = "ExtractionTimeoutError";
  }
}
