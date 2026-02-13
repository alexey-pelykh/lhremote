// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { CDPClient, CDPConnectionError, CDPEvaluationError } from "../cdp/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type {
  Account,
  InstanceStatus,
  StartInstanceResult,
} from "../types/index.js";
import {
  LinkedHelperNotRunningError,
  ServiceError,
  StartInstanceError,
  WrongPortError,
} from "./errors.js";

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
  private readonly allowRemote: boolean;
  private client: CDPClient | null = null;

  constructor(
    port: number = DEFAULT_CDP_PORT,
    options?: { host?: string; allowRemote?: boolean },
  ) {
    this.port = port;
    this.host = options?.host ?? "127.0.0.1";
    this.allowRemote = options?.allowRemote ?? false;
  }

  /**
   * Connect to the LinkedHelper launcher via CDP.
   *
   * @throws {LinkedHelperNotRunningError} if the launcher is not reachable.
   */
  async connect(): Promise<void> {
    const client = new CDPClient(this.port, { host: this.host, allowRemote: this.allowRemote });
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

    const result = await this.launcherEvaluate<StartInstanceResult>(
      client,
      `(async () => {
        try {
          const remote = require('@electron/remote');
          const mainWindow = remote.getGlobal('mainWindow');
          await mainWindow.startInstance({
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
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message };
        }
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

    await this.launcherEvaluate(
      client,
      `(async () => {
        const remote = require('@electron/remote');
        const mainWindow = remote.getGlobal('mainWindow');
        return await mainWindow.instanceManager.stopInstance(${String(accountId)});
      })()`,
      true,
    );
  }

  /**
   * Query the status of an instance for the given account.
   */
  async getInstanceStatus(accountId: number): Promise<InstanceStatus> {
    const client = this.ensureConnected();

    // NOTE: instanceManager.instances is always empty in the renderer process
    // due to cross-process architecture (instances run as separate OS processes).
    // This returns 'stopped' until a reliable IPC-based status query is implemented.
    const status = await this.launcherEvaluate<string>(
      client,
      `(() => {
        const remote = require('@electron/remote');
        const mainWindow = remote.getGlobal('mainWindow');
        const im = mainWindow.instanceManager;
        const instance = im.instances?.[${String(accountId)}];
        return instance?.status ?? 'stopped';
      })()`,
    );

    return status as InstanceStatus;
  }

  /**
   * List all accounts configured in the LinkedHelper Electron store.
   *
   * Accounts are discovered from the `linkedInPasswords` store key whose
   * entries use the format `userId:li:accountId`.
   */
  async listAccounts(): Promise<Account[]> {
    const client = this.ensureConnected();

    const accounts = await this.launcherEvaluate<Account[]>(
      client,
      `(() => {
        const remote = require('@electron/remote');
        const mainWindow = remote.getGlobal('mainWindow');
        const store = mainWindow.electronStore;
        const passwords = store.get('linkedInPasswords') ?? {};
        return Object.keys(passwords)
          .map(k => {
            const parts = k.split(':li:');
            if (parts.length !== 2) return null;
            const accountId = Number(parts[1]);
            if (Number.isNaN(accountId)) return null;
            return {
              id: accountId,
              liId: accountId,
              name: '',
              email: undefined,
            };
          })
          .filter(a => a !== null);
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

  private async launcherEvaluate<T = unknown>(
    client: CDPClient,
    expression: string,
    awaitPromise = false,
  ): Promise<T> {
    try {
      return await client.evaluate<T>(expression, awaitPromise);
    } catch (error) {
      if (
        error instanceof CDPEvaluationError &&
        error.message.includes("require is not defined")
      ) {
        throw new WrongPortError(this.port);
      }
      throw error;
    }
  }
}
