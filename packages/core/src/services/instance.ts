import { CDPClient, discoverTargets } from "../cdp/index.js";
import type { CdpTarget } from "../types/cdp.js";
import { ActionExecutionError, InstanceNotRunningError, ServiceError } from "./errors.js";

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
  private linkedInClient: CDPClient | null = null;
  private uiClient: CDPClient | null = null;

  constructor(port: number, options?: { host?: string }) {
    this.port = port;
    this.host = options?.host ?? "127.0.0.1";
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

      await new Promise<void>((resolve) => setTimeout(resolve, CONNECT_POLL_INTERVAL));
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

    const liClient = new CDPClient(this.port, { host: this.host });
    await liClient.connect(linkedInTarget.id);

    const ui = new CDPClient(this.port, { host: this.host });
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
   */
  async navigateToProfile(url: string): Promise<void> {
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
      const message = error instanceof Error ? error.message : String(error);
      throw new ActionExecutionError(actionName, `Action '${actionName}' failed: ${message}`, { cause: error });
    }

    return { success: true, actionType: actionName };
  }

  /**
   * Trigger the SaveCurrentProfile action via the instance UI.
   *
   * This tells LinkedHelper to extract data from the currently
   * displayed LinkedIn profile and save it to the database.
   */
  async triggerExtraction(): Promise<void> {
    await this.executeAction("SaveCurrentProfile");
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
}

function isLinkedInTarget(target: CdpTarget): boolean {
  return target.type === "page" && target.url.includes("linkedin.com");
}

function isUiTarget(target: CdpTarget): boolean {
  return target.type === "page" && target.url.includes("index.html");
}

