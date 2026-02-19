// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { CDPClient, CDPTimeoutError, discoverTargets } from "../cdp/index.js";
import type { CdpTarget } from "../types/cdp.js";
import { delay } from "../utils/delay.js";
import { errorMessage } from "../utils/error-message.js";
import { ActionExecutionError, InstanceNotRunningError, InvalidProfileUrlError, ServiceError, UIBlockedError } from "./errors.js";

/**
 * Result of a LinkedHelper action execution.
 */
export interface ActionResult {
  /** Whether the action completed successfully. */
  success: boolean;
  /** The action type that was executed. */
  actionType: string;
  /** Error message if the action failed. */
  error?: string;
}

/** Maximum time to wait for both CDP targets to appear (ms). */
const CONNECT_TIMEOUT = 30_000;

/** Interval between target discovery polls (ms). */
const CONNECT_POLL_INTERVAL = 1_000;

/**
 * A callback that checks UI health after a CDP evaluation.
 *
 * Should throw {@link UIBlockedError} if the UI is in a blocked state.
 */
export type HealthChecker = () => Promise<void>;

/**
 * Controls a running LinkedHelper instance via CDP.
 *
 * An instance has two CDP targets on the same port:
 * - **LinkedIn webview**: The Chromium page rendering linkedin.com
 * - **Instance UI**: The Electron page hosting the LinkedHelper UI
 *
 * This service connects to both targets and provides methods for
 * profile navigation and data extraction.
 */
export class InstanceService {
  private readonly port: number;
  private readonly host: string;
  private readonly timeout: number | undefined;
  private readonly allowRemote: boolean;
  private linkedInClient: CDPClient | null = null;
  private uiClient: CDPClient | null = null;
  private healthChecker: HealthChecker | null = null;

  constructor(port: number, options?: { host?: string; timeout?: number; allowRemote?: boolean }) {
    this.port = port;
    this.host = options?.host ?? "127.0.0.1";
    this.timeout = options?.timeout;
    this.allowRemote = options?.allowRemote ?? false;
  }

  /**
   * Set a post-evaluation health check callback.
   *
   * When set, every {@link evaluateUI} and {@link executeAction} call
   * will invoke the checker after the CDP evaluation completes.
   * On {@link CDPTimeoutError}, the checker is also invoked to diagnose
   * the cause of the timeout.
   */
  setHealthChecker(checker: HealthChecker | null): void {
    this.healthChecker = checker;
  }

  /**
   * Connect to both instance CDP targets (LinkedIn page and UI).
   *
   * The instance may still be loading LinkedIn after startup, so this
   * method polls until both targets appear or the timeout is reached.
   *
   * @throws {InstanceNotRunningError} if the expected targets are not found within the timeout.
   */
  async connect(): Promise<void> {
    const deadline = Date.now() + CONNECT_TIMEOUT;

    let targets: CdpTarget[] = [];
    let linkedInTarget: CdpTarget | undefined;
    let uiTarget: CdpTarget | undefined;

    while (Date.now() < deadline) {
      targets = await discoverTargets(this.port, this.host);

      linkedInTarget = targets.find(isLinkedInTarget);
      uiTarget = targets.find(isUiTarget);

      if (linkedInTarget && uiTarget) {
        break;
      }

      await delay(CONNECT_POLL_INTERVAL);
    }

    if (!linkedInTarget) {
      throw new InstanceNotRunningError(
        `LinkedIn webview target not found among ${String(targets.length)} CDP target(s) on port ${String(this.port)}`,
      );
    }
    if (!uiTarget) {
      throw new InstanceNotRunningError(
        `Instance UI target not found among ${String(targets.length)} CDP target(s) on port ${String(this.port)}`,
      );
    }

    const clientOptions = {
      host: this.host,
      ...(this.timeout !== undefined && { timeout: this.timeout }),
      allowRemote: this.allowRemote,
    };

    const liClient = new CDPClient(this.port, clientOptions);
    await liClient.connect(linkedInTarget.id);

    const ui = new CDPClient(this.port, clientOptions);
    await ui.connect(uiTarget.id);

    this.linkedInClient = liClient;
    this.uiClient = ui;
  }

  /**
   * Disconnect from both targets.
   */
  disconnect(): void {
    this.linkedInClient?.disconnect();
    this.linkedInClient = null;
    this.uiClient?.disconnect();
    this.uiClient = null;
  }

  /**
   * Navigate the LinkedIn webview to a profile URL.
   *
   * Enables the Page domain, navigates, and waits for the load event.
   *
   * @throws {InvalidProfileUrlError} if the URL is not a valid LinkedIn profile path.
   */
  async navigateToProfile(url: string): Promise<void> {
    assertLinkedInProfileUrl(url);

    const client = this.ensureLinkedInClient();

    await client.send("Page.enable");
    await client.navigate(url);
    await client.waitForEvent("Page.loadEventFired");
  }

  /**
   * Execute a LinkedHelper action via the instance UI.
   *
   * This tells LinkedHelper to run the given action type with the
   * provided configuration object. The call resolves when the action
   * completes (which may take minutes for long-running actions like
   * ScrapeMessagingHistory).
   *
   * @param actionName  The action type (e.g., 'SaveCurrentProfile', 'ScrapeMessagingHistory').
   * @param config      Action configuration object (default: `{}`).
   */
  async executeAction(
    actionName: string,
    config: Record<string, unknown> = {},
  ): Promise<ActionResult> {
    const client = this.ensureUiClient();

    try {
      await client.evaluate(
        `(async () => {
        const mws = window.mainWindowService;
        if (!mws) throw new Error('mainWindowService not found on window');
        return await mws.call('executeSingleAction', ${JSON.stringify(actionName)}, ${JSON.stringify(config)});
      })()`,
        true,
      );
    } catch (error) {
      if (error instanceof CDPTimeoutError) {
        await this.runHealthCheck();
      }
      const message = errorMessage(error);
      throw new ActionExecutionError(actionName, `Action '${actionName}' failed: ${message}`, { cause: error });
    }

    await this.runHealthCheck();
    return { success: true, actionType: actionName };
  }

  /**
   * Evaluate a JavaScript expression in the LinkedHelper UI context.
   *
   * Provides access to `window.mainWindowService.mainWindow.source.*`
   * and other LinkedHelper internal APIs that are only available on
   * the UI target.
   *
   * @param expression  JavaScript source to evaluate.
   * @param awaitPromise Whether to await a Promise result (default `true`).
   */
  async evaluateUI<T = unknown>(
    expression: string,
    awaitPromise = true,
  ): Promise<T> {
    const client = this.ensureUiClient();
    try {
      const result = await client.evaluate<T>(expression, awaitPromise);
      await this.runHealthCheck();
      return result;
    } catch (error) {
      if (error instanceof CDPTimeoutError) {
        await this.runHealthCheck();
      }
      throw error;
    }
  }

  /** Whether both clients are currently connected. */
  get isConnected(): boolean {
    return (
      this.linkedInClient !== null &&
      this.linkedInClient.isConnected &&
      this.uiClient !== null &&
      this.uiClient.isConnected
    );
  }

  private ensureLinkedInClient(): CDPClient {
    if (!this.linkedInClient) {
      throw new ServiceError("InstanceService is not connected (LinkedIn target)");
    }
    return this.linkedInClient;
  }

  private ensureUiClient(): CDPClient {
    if (!this.uiClient) {
      throw new ServiceError("InstanceService is not connected (UI target)");
    }
    return this.uiClient;
  }

  /**
   * Run the health checker if one is configured.
   *
   * Non-UIBlockedError failures (e.g. launcher connection lost) are
   * silently ignored so that health check infrastructure issues do
   * not mask the original operation result.
   */
  private async runHealthCheck(): Promise<void> {
    if (!this.healthChecker) return;
    try {
      await this.healthChecker();
    } catch (error) {
      if (error instanceof UIBlockedError) throw error;
      // Health check infrastructure failure — do not mask the original result.
    }
  }
}

const LINKEDIN_PROFILE_URL_RE = /^https:\/\/www\.linkedin\.com\/in\/[^/]+\/?$/;

function assertLinkedInProfileUrl(url: string): void {
  if (!LINKEDIN_PROFILE_URL_RE.test(url)) {
    throw new InvalidProfileUrlError(url);
  }
}

function isLinkedInTarget(target: CdpTarget): boolean {
  return target.type === "page" && target.url.includes("linkedin.com");
}

function isUiTarget(target: CdpTarget): boolean {
  return target.type === "page" && target.url.includes("index.html");
}

