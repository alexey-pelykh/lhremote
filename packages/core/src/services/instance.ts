import { CDPClient, discoverTargets } from "../cdp/index.js";
import type { CdpTarget } from "../types/cdp.js";
import { InstanceNotRunningError, ServiceError } from "./errors.js";

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
   * @throws {InstanceNotRunningError} if the expected targets are not found.
   */
  async connect(): Promise<void> {
    const targets = await discoverTargets(this.port, this.host);

    const linkedInTarget = targets.find(isLinkedInTarget);
    const uiTarget = targets.find(isUiTarget);

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
   * Trigger the SaveCurrentProfile action via the instance UI.
   *
   * This tells LinkedHelper to extract data from the currently
   * displayed LinkedIn profile and save it to the database.
   */
  async triggerExtraction(): Promise<void> {
    const client = this.ensureUiClient();

    await client.evaluate(
      `(async () => {
        const remote = require('@electron/remote');
        const mws = remote.getGlobal('mainWindowService');
        return await mws.call('executeSingleAction', 'SaveCurrentProfile', {});
      })()`,
      true,
    );
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

