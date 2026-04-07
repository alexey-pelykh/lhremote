// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { CDPClient, CDPTimeoutError, discoverTargets } from "../cdp/index.js";
import { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import type { CdpTarget } from "../types/cdp.js";
import type { InstancePopup } from "../types/index.js";
import { delay } from "../utils/delay.js";
import { errorMessage } from "../utils/error-message.js";
import { ActionExecutionError, InstanceNotRunningError, ServiceError, UIBlockedError } from "./errors.js";

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
 * data extraction and action execution.
 */
export class InstanceService {
  private readonly port: number;
  private readonly host: string;
  private readonly timeout: number | undefined;
  private readonly allowRemote: boolean;
  private linkedInClient: CDPClient | null = null;
  private uiClient: CDPClient | null = null;
  private healthChecker: HealthChecker | null = null;
  private healthCheckRunning = false;
  private humanizedMouse: HumanizedMouse | null = null;

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
   * Connect to only the instance UI target, without requiring the LinkedIn webview.
   *
   * Use this for partial-start scenarios where LinkedHelper failed to initialize
   * and the LinkedIn webview was never created. After this call, {@link evaluateUI}
   * and UI-dependent methods work, but LinkedIn-dependent methods like
   * {@link navigateLinkedIn} will throw.
   *
   * @throws {InstanceNotRunningError} if the UI target is not found within the timeout.
   */
  async connectUiOnly(): Promise<void> {
    const deadline = Date.now() + CONNECT_TIMEOUT;

    let targets: CdpTarget[] = [];
    let uiTarget: CdpTarget | undefined;

    while (Date.now() < deadline) {
      targets = await discoverTargets(this.port, this.host);

      uiTarget = targets.find(isUiTarget);

      if (uiTarget) {
        break;
      }

      await delay(CONNECT_POLL_INTERVAL);
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

    const ui = new CDPClient(this.port, clientOptions);
    await ui.connect(uiTarget.id);

    this.uiClient = ui;
  }

  /**
   * Disconnect from both targets.
   */
  disconnect(): void {
    this.humanizedMouse = null;
    this.linkedInClient?.disconnect();
    this.linkedInClient = null;
    this.uiClient?.disconnect();
    this.uiClient = null;
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

  /**
   * Navigate the LinkedIn webview to the given URL.
   *
   * Enables the CDP Page domain so that `Page.loadEventFired` events
   * are delivered, navigates, and waits for the load event before
   * returning.  This ensures the webview is on the expected page
   * before downstream operations like `canCollect` are called.
   *
   * @throws {ServiceError} if the client is not connected.
   */
  async navigateLinkedIn(url: string): Promise<void> {
    const client = this.ensureLinkedInClient();
    await client.send("Page.enable");
    try {
      const loadPromise = client.waitForEvent("Page.loadEventFired");
      await client.navigate(url);
      await loadPromise;
    } finally {
      await client.send("Page.disable").catch(() => {});
    }
  }

  /**
   * Detect error/popup elements in the instance UI DOM.
   *
   * The instance UI can show error popups (e.g., "Failed to initialize UI",
   * "AsyncHandlerError: liAccount not initialized") that render behind the
   * LinkedIn webview and are invisible to the user.  This method queries
   * the DOM using multiple selector strategies to find them.
   *
   * @returns An array of detected popups, or an empty array if none are visible.
   */
  async getInstancePopups(): Promise<InstancePopup[]> {
    return this.evaluateUI<InstancePopup[]>(
      `(() => {
        const popups = [];
        const seen = new WeakSet();

        const seenTitles = new Set();

        function isVisible(el) {
          const style = getComputedStyle(el);
          const opacity = Number.parseFloat(style.opacity);
          if (style.display === 'none' || style.visibility === 'hidden' || (!Number.isNaN(opacity) && opacity <= 0)) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        // Strategy 1: class-based selectors for known popup components
        for (const header of document.querySelectorAll('[class*="Popup_Header_"], [class*="ErrorAndAlert_Title_"]')) {
          const container = header.closest('[class*="Popup_Container_"], [class*="Popup_Wrapper_"], [class*="Popup_Popup_"], [class*="ErrorAndAlert_"]') || header.parentElement;
          if (!container || seen.has(container) || !isVisible(container)) continue;
          seen.add(container);
          const title = header.textContent?.trim() || '';
          if (!title) continue;
          const description = container.querySelector('[class*="Popup_Body_"], [class*="Popup_BodyScroll_"], [class*="ErrorAndAlert_Description_"]')?.textContent?.trim() || undefined;
          const key = title + '\\0' + (description || '');
          if (seenTitles.has(key)) continue;
          seenTitles.add(key);
          const controls = container.querySelector('[class*="Popup_Controls_"], [class*="Popup_Buttons_"], [class*="Popup_Footer_"]');
          popups.push({
            title,
            description,
            closable: controls ? controls.querySelectorAll('button').length > 0 : false,
          });
        }

        // Strategy 2: role-based fallback for dialogs not caught above
        for (const dialog of document.querySelectorAll('[role="dialog"]')) {
          if (seen.has(dialog) || !isVisible(dialog)) continue;
          seen.add(dialog);
          const heading = dialog.querySelector('h1, h2, h3, [class*="Header"], [class*="Title"]');
          const title = heading?.textContent?.trim() || dialog.firstElementChild?.textContent?.trim() || '';
          if (!title) continue;
          const description = dialog.querySelector('[class*="Body"], [class*="Description"], [class*="Content"]')?.textContent?.trim() || undefined;
          const key = title + '\\0' + (description || '');
          if (seenTitles.has(key)) continue;
          seenTitles.add(key);
          popups.push({
            title,
            description,
            closable: dialog.querySelectorAll('button').length > 0,
          });
        }

        return popups;
      })()`,
      false,
    );
  }

  /**
   * Dismiss popups in the instance UI.
   *
   * Closable popups (those with buttons) are dismissed by clicking their
   * button.  Non-closable popups are force-removed from the DOM so they
   * no longer block subsequent UI operations.
   *
   * @returns An object with `dismissed` — the total number of popups removed
   *          (both button-clicked and force-removed) — and `nonDismissable`
   *          (always `0` since non-closable popups are now force-removed).
   */
  async dismissInstancePopups(): Promise<{ dismissed: number; nonDismissable: number }> {
    return this.evaluateUI<{ dismissed: number; nonDismissable: number }>(
      `(() => {
        let dismissed = 0;
        const seen = new WeakSet();

        function isVisible(el) {
          const style = getComputedStyle(el);
          const opacity = Number.parseFloat(style.opacity);
          if (style.display === 'none' || style.visibility === 'hidden' || (!Number.isNaN(opacity) && opacity <= 0)) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        // Strategy 1: class-based selectors for known popup components
        for (const header of document.querySelectorAll('[class*="Popup_Header_"], [class*="ErrorAndAlert_Title_"]')) {
          const container = header.closest('[class*="Popup_Container_"], [class*="Popup_Wrapper_"], [class*="Popup_Popup_"], [class*="ErrorAndAlert_"]') || header.parentElement;
          if (!container || seen.has(container) || !isVisible(container)) continue;
          seen.add(container);
          const controls = container.querySelector('[class*="Popup_Controls_"], [class*="Popup_Buttons_"], [class*="Popup_Footer_"]');
          const button = controls?.querySelector('button');
          if (button) {
            button.click();
            dismissed++;
          } else {
            container.remove();
            dismissed++;
          }
        }

        // Strategy 2: role-based fallback for dialogs not caught above
        for (const dialog of document.querySelectorAll('[role="dialog"]')) {
          if (seen.has(dialog) || !isVisible(dialog)) continue;
          seen.add(dialog);
          const button = dialog.querySelector('button');
          if (button) {
            button.click();
            dismissed++;
          } else {
            dialog.remove();
            dismissed++;
          }
        }

        return { dismissed, nonDismissable: 0 };
      })()`,
      false,
    );
  }

  /**
   * Reload the instance UI page via CDP.
   *
   * This is a heavy-handed recovery mechanism: it restarts the React app,
   * clearing all cached error state (including popups that survive DOM
   * removal because React re-renders them from internal state).
   *
   * Waits for the page `load` event before resolving.
   */
  async reloadUI(): Promise<void> {
    const client = this.ensureUiClient();
    await client.send("Page.enable");
    try {
      const loadPromise = client.waitForEvent("Page.loadEventFired");
      await client.send("Page.reload");
      await loadPromise;
    } finally {
      await client.send("Page.disable").catch(() => {});
    }
  }

  /**
   * Create a {@link HumanizedMouse} that wraps LH's VirtualMouse.
   *
   * Returns a cached instance — only one exists per connection.
   * The mouse is probed lazily; call `await mouse.initialize()` before
   * using it if you need to check availability.
   */
  createHumanizedMouse(): HumanizedMouse {
    if (!this.humanizedMouse) {
      this.humanizedMouse = new HumanizedMouse(this);
    }
    return this.humanizedMouse;
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
    if (!this.healthChecker || this.healthCheckRunning) return;
    this.healthCheckRunning = true;
    try {
      await this.healthChecker();
    } catch (error) {
      if (error instanceof UIBlockedError) throw error;
      // Health check infrastructure failure — do not mask the original result.
    } finally {
      this.healthCheckRunning = false;
    }
  }
}

function isLinkedInTarget(target: CdpTarget): boolean {
  return target.type === "page" && target.url.includes("linkedin.com");
}

function isUiTarget(target: CdpTarget): boolean {
  return target.type === "page" && target.url.includes("index.html");
}

