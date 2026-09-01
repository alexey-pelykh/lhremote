// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { DiscoveredApp } from "../cdp/index.js";
import type { UIHealthStatus } from "../types/index.js";

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
  constructor(port?: number) {
    super(
      port !== undefined
        ? `LinkedHelper is not running (no CDP endpoint at port ${String(port)})`
        : "LinkedHelper is not running (no processes found)",
    );
    this.name = "LinkedHelperNotRunningError";
  }
}

/**
 * Thrown when the LinkedHelper application is running as an OS process
 * but its CDP endpoint is not reachable (e.g., started without
 * `--remote-debugging-port`, or CDP crashed).
 *
 * The {@link processes} property contains the discovered process info
 * so callers can report PIDs and suggest corrective action.
 */
export class LinkedHelperUnreachableError extends ServiceError {
  readonly processes: DiscoveredApp[];

  constructor(processes: DiscoveredApp[]) {
    const pids = processes.map((p) => String(p.pid)).join(", ");
    super(
      `LinkedHelper is running (PID ${pids}) but CDP is not reachable. ` +
        "Restart LinkedHelper or use launch-app with force: true.",
    );
    this.name = "LinkedHelperUnreachableError";
    this.processes = processes;
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
  readonly port: number;

  constructor(port: number) {
    super(
      `CDP port ${String(port)} appears to be a LinkedHelper instance, not the launcher. ` +
        "Use the launcher port instead (omit cdpPort to auto-discover).",
    );
    this.name = "WrongPortError";
    this.port = port;
  }
}

/**
 * Thrown when the LinkedHelper launcher renderer does not provide
 * a Node.js execution context (`require` is unavailable in all
 * CDP execution contexts).
 *
 * This typically means LinkedHelper has changed its Electron
 * configuration beyond what lhremote currently supports.
 */
export class NodeIntegrationUnavailableError extends ServiceError {
  constructor() {
    super(
      "LinkedHelper launcher does not expose Node.js APIs (require is unavailable). " +
        "This may indicate an unsupported LinkedHelper version.",
    );
    this.name = "NodeIntegrationUnavailableError";
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
 * Thrown when a profile URL fails validation (e.g. not a LinkedIn
 * profile path, or uses a forbidden scheme like `file://`).
 */
export class InvalidProfileUrlError extends ServiceError {
  constructor(url: string) {
    super(
      `Invalid profile URL: ${url} — expected https://www.linkedin.com/in/<slug>`,
    );
    this.name = "InvalidProfileUrlError";
  }
}

/**
 * Thrown when extraction times out waiting for data to appear.
 *
 * `subject` defaults to `"Profile"` for backward compatibility with the
 * original database-extraction call shape; the post-detail readiness gate
 * passes `"Post-detail"` and names the selector that never matched.
 */
export class ExtractionTimeoutError extends ServiceError {
  /** What was being waited for — a URL, or a description of the anchor. */
  readonly target: string;
  readonly timeoutMs: number;
  /** Which extraction subject timed out (e.g. 'Profile', 'Post-detail'). */
  readonly subject: string;

  constructor(target: string, timeoutMs: number, subject = "Profile") {
    super(
      `${subject} extraction timed out after ${String(timeoutMs)}ms for ${target}`,
    );
    this.name = "ExtractionTimeoutError";
    this.target = target;
    this.timeoutMs = timeoutMs;
    this.subject = subject;
  }
}

/**
 * Thrown when no registered `VariantAdapter` recognises the page.
 *
 * This is the "LinkedIn changed" signal. It is deliberately distinct from
 * {@link ExtractionFailedError}: nothing is stale here, the page simply
 * speaks a dialect no adapter knows, and the operator action is to register
 * a new adapter rather than repair an existing one.
 *
 * It is also deliberately NOT {@link ExtractionTimeoutError} — nothing timed
 * out. The whole defect class this models is a gate going green promptly on
 * a page the scrapers cannot read.
 */
export class DOMVariantUnsupportedError extends ServiceError {
  /** The surface being read (e.g. 'post-detail', 'feed'). */
  readonly surface: string;
  /** Variants that were offered the page and declined it. */
  readonly triedVariants: readonly string[];

  constructor(
    surface: string,
    triedVariants: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      `No DOM adapter matched the ${surface} page ` +
        `(tried: ${triedVariants.length > 0 ? triedVariants.join(", ") : "none registered"}). ` +
        "LinkedIn has changed its markup — register an adapter for the new variant.",
      options,
    );
    this.name = "DOMVariantUnsupportedError";
    this.surface = surface;
    this.triedVariants = triedVariants;
  }
}

/**
 * Thrown when an adapter matched the page but a field came back empty and
 * its same-observation corroborator contradicts that emptiness.
 *
 * This is the "partially stale adapter" signal: the dialect is recognised,
 * so the fix is to repair the named field's selectors rather than register
 * a new adapter. Naming both the variant and the field is load-bearing —
 * an agent consuming the MCP tool is the least able party to diagnose this.
 */
export class ExtractionFailedError extends ServiceError {
  readonly surface: string;
  readonly variant: string;
  /** The field whose emptiness was contradicted. */
  readonly field: string;
  /** The corroborating observation that contradicted it. */
  readonly corroborator: string;

  constructor(
    args: {
      surface: string;
      variant: string;
      field: string;
      corroborator: string;
    },
    options?: ErrorOptions,
  ) {
    super(
      `Extraction failed on the ${args.surface} page: adapter "${args.variant}" matched, ` +
        `but field "${args.field}" came back empty while ${args.corroborator} contradicts it. ` +
        `Adapter "${args.variant}" is partially stale — repair the selectors for "${args.field}".`,
      options,
    );
    this.name = "ExtractionFailedError";
    this.surface = args.surface;
    this.variant = args.variant;
    this.field = args.field;
    this.corroborator = args.corroborator;
  }
}

/**
 * Thrown when two or more adapters claim the same page.
 *
 * A transitional or hybrid page. Failing loudly is deliberate: picking one
 * adapter would build a record from two dialects with no way to notice,
 * which is the failure mode the whole variant model exists to prevent.
 */
export class DOMVariantAmbiguousError extends ServiceError {
  readonly surface: string;
  readonly matchedVariants: readonly string[];

  constructor(
    surface: string,
    matchedVariants: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      `Multiple DOM adapters matched the ${surface} page ` +
        `(${matchedVariants.join(", ")}). This is a transitional or hybrid page; ` +
        "refusing to guess which adapter owns it — tighten the detect anchors.",
      options,
    );
    this.name = "DOMVariantAmbiguousError";
    this.surface = surface;
    this.matchedVariants = matchedVariants;
  }
}

/**
 * Thrown when a collection operation fails during execution
 * (canCollect, prepareCollecting, collect, or other CDP-based operations).
 */
export class CollectionError extends ServiceError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CollectionError";
  }
}

/**
 * Thrown when a collection operation cannot proceed because the
 * LinkedHelper instance is busy (running a campaign, another
 * collection, or a single action).
 */
export class CollectionBusyError extends CollectionError {
  readonly runnerState: string;

  constructor(runnerState: string, options?: ErrorOptions) {
    super(
      `Cannot start collection — instance is busy (runner state: ${runnerState})`,
      options,
    );
    this.name = "CollectionBusyError";
    this.runnerState = runnerState;
  }
}

/**
 * Thrown when a campaign operation fails during execution
 * (create, start, stop, or other CDP-based operations).
 */
export class CampaignExecutionError extends ServiceError {
  readonly campaignId: number | undefined;

  constructor(message: string, campaignId?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "CampaignExecutionError";
    this.campaignId = campaignId;
  }
}

/**
 * Thrown when a campaign operation times out waiting for
 * a state transition (e.g., runner not reaching idle).
 */
export class CampaignTimeoutError extends ServiceError {
  readonly campaignId: number | undefined;

  constructor(message: string, campaignId?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "CampaignTimeoutError";
    this.campaignId = campaignId;
  }
}

/**
 * Thrown when an action cannot proceed because its daily budget
 * has been exhausted.
 */
export class BudgetExceededError extends ServiceError {
  readonly limitType: string;
  readonly dailyLimit: number;
  readonly totalUsed: number;

  constructor(limitType: string, dailyLimit: number, totalUsed: number) {
    super(
      `Action budget exceeded for ${limitType}: ` +
        `${String(totalUsed)}/${String(dailyLimit)} used today`,
    );
    this.name = "BudgetExceededError";
    this.limitType = limitType;
    this.dailyLimit = dailyLimit;
    this.totalUsed = totalUsed;
  }
}

/**
 * Thrown when the LinkedHelper UI is in a blocked state due to
 * a dialog, critical error, or blocking popup.
 *
 * The {@link health} property contains the full UI health status
 * including active issues and popup state.
 */
export class UIBlockedError extends ServiceError {
  readonly health: UIHealthStatus;

  constructor(health: UIHealthStatus, options?: ErrorOptions) {
    const reasons: string[] = [];

    for (const issue of health.issues) {
      if (issue.type === "dialog") {
        reasons.push(`Dialog: ${issue.data.options.message}`);
      } else {
        reasons.push(`Critical error: ${issue.data.message}`);
      }
    }

    if (health.popup?.blocked) {
      reasons.push(`Popup: ${health.popup.message ?? "blocking overlay active"}`);
    }

    for (const instancePopup of health.instancePopups) {
      reasons.push(`Instance popup: ${instancePopup.title}${instancePopup.description ? ` — ${instancePopup.description}` : ""}`);
    }

    super(
      `LinkedHelper UI is blocked — ${reasons.join("; ")}`,
      options,
    );
    this.name = "UIBlockedError";
    this.health = health;
  }
}
