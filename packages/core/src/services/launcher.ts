import { CDPClient, CDPConnectionError } from "../cdp/index.js";
import type {
  Account,
  InstanceStatus,
  StartInstanceResult,
} from "../types/index.js";
import {
  LinkedHelperNotRunningError,
  ServiceError,
  StartInstanceError,
} from "./errors.js";

/** Default CDP port for the LinkedHelper launcher process. */
const DEFAULT_LAUNCHER_PORT = 9222;

/**
 * Controls the LinkedHelper launcher process via CDP.
 *
 * The launcher is the main Electron window that manages LinkedIn
 * account instances.  This service connects to it and provides
 * methods to start/stop instances and query accounts.
 */
export class LauncherService {
  private readonly port: number;
  private readonly host: string;
  private client: CDPClient | null = null;

  constructor(
    port: number = DEFAULT_LAUNCHER_PORT,
    options?: { host?: string },
  ) {
    this.port = port;
    this.host = options?.host ?? "127.0.0.1";
  }

  /**
   * Connect to the LinkedHelper launcher via CDP.
   *
   * @throws {LinkedHelperNotRunningError} if the launcher is not reachable.
   */
  async connect(): Promise<void> {
    const client = new CDPClient(this.port, { host: this.host });
    try {
      await client.connect();
    } catch (error) {
      if (error instanceof CDPConnectionError) {
        throw new LinkedHelperNotRunningError(this.port);
      }
      throw error;
    }
    this.client = client;
  }

  /**
   * Disconnect from the launcher.
   */
  disconnect(): void {
    this.client?.disconnect();
    this.client = null;
  }

  /**
   * Start a LinkedHelper instance for the given account.
   *
   * @throws {StartInstanceError} if the instance fails to start.
   */
  async startInstance(accountId: number): Promise<void> {
    const client = this.ensureConnected();

    const result = await client.evaluate<StartInstanceResult>(
      `(async () => {
        const remote = require('@electron/remote');
        const mws = remote.getGlobal('mainWindowService');
        return await mws.call('startInstance', {
          linkedInAccount: { id: ${String(accountId)}, liId: ${String(accountId)} },
          accountData: { id: ${String(accountId)}, liId: ${String(accountId)} },
          instanceId: 1,
          proxy: null,
          license: null,
          userId: null,
          frontendSettings: {},
          lhAccount: {},
          zoomDefault: 0.9,
          shouldBringToFront: true,
          shouldStartRunningCampaigns: false,
        });
      })()`,
      true,
    );

    if (!result.success) {
      throw new StartInstanceError(accountId, result.error);
    }
  }

  /**
   * Stop a running LinkedHelper instance.
   */
  async stopInstance(accountId: number): Promise<void> {
    const client = this.ensureConnected();

    await client.evaluate(
      `(async () => {
        const remote = require('@electron/remote');
        const mws = remote.getGlobal('mainWindowService');
        return await mws.call('stopInstance', ${String(accountId)});
      })()`,
      true,
    );
  }

  /**
   * Query the status of an instance for the given account.
   */
  async getInstanceStatus(accountId: number): Promise<InstanceStatus> {
    const client = this.ensureConnected();

    const status = await client.evaluate<string>(
      `(async () => {
        const remote = require('@electron/remote');
        const mws = remote.getGlobal('mainWindowService');
        const info = await mws.call('getInstanceStatus', ${String(accountId)});
        return info?.status ?? 'stopped';
      })()`,
      true,
    );

    return status as InstanceStatus;
  }

  /**
   * List all accounts configured in the LinkedHelper Electron store.
   */
  async listAccounts(): Promise<Account[]> {
    const client = this.ensureConnected();

    const accounts = await client.evaluate<Account[]>(
      `(() => {
        const remote = require('@electron/remote');
        const store = remote.getGlobal('electronStore');
        const accounts = store.get('accounts') ?? [];
        return accounts;
      })()`,
    );

    return accounts ?? [];
  }

  /** Whether the service is currently connected to the launcher. */
  get isConnected(): boolean {
    return this.client !== null && this.client.isConnected;
  }

  private ensureConnected(): CDPClient {
    if (!this.client) {
      throw new ServiceError("LauncherService is not connected");
    }
    return this.client;
  }
}
