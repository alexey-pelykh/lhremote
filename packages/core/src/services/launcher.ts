// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { CDPClient, CDPConnectionError, findApp } from "../cdp/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type {
  Account,
  InstanceIssue,
  InstanceStatus,
  PopupState,
  StartInstanceResult,
  UIHealthStatus,
} from "../types/index.js";
import {
  LinkedHelperNotRunningError,
  LinkedHelperUnreachableError,
  NodeIntegrationUnavailableError,
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
  /**
   * CDP expression snippet that waits for the webpack module registry
   * and sets `wpRequire` in the enclosing scope.  Callers must check
   * `wpRequire` for null and handle the failure case themselves.
   */
  private static readonly WEBPACK_INIT = `
    const _wpDeadline = Date.now() + 15000;
    while (!window.webpackChunk_linked_helper_front && Date.now() < _wpDeadline) {
      await new Promise(r => setTimeout(r, 250));
    }
    let wpRequire = null;
    if (window.webpackChunk_linked_helper_front) {
      window.webpackChunk_linked_helper_front.push(
        [[Symbol()], {}, (req) => { wpRequire = req; }]
      );
    }`;

  private readonly port: number;
  private readonly host: string;
  private readonly allowRemote: boolean;
  private client: CDPClient | null = null;
  private nodeContextId: number | undefined;

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
        const apps = await findApp();
        if (apps.length > 0) {
          throw new LinkedHelperUnreachableError(apps);
        }
        throw new LinkedHelperNotRunningError(this.port);
      }
      throw error;
    }

    let nodeContextId: number | undefined;
    try {
      nodeContextId = await this.resolveNodeContextId(client);
    } catch {
      // No Node.js context — likely a LinkedIn page on the instance port.
      client.disconnect();
      throw new WrongPortError(this.port);
    }

    // Validate that the target is the launcher (has electronStore),
    // not an instance UI page that happens to have Node.js access.
    const isLauncher = await client.evaluate<boolean>(
      `(() => {
        try {
          const r = require('@electron/remote');
          return typeof r.getGlobal('mainWindow')?.electronStore?.get === 'function';
        } catch { return false; }
      })()`,
      false,
      nodeContextId,
    );
    if (!isLauncher) {
      client.disconnect();
      throw new WrongPortError(this.port);
    }

    this.client = client;
    this.nodeContextId = nodeContextId;
  }

  /**
   * Disconnect from the launcher.
   */
  disconnect(): void {
    this.client?.disconnect();
    this.client = null;
    this.nodeContextId = undefined;
  }

  /**
   * Start a LinkedHelper instance for the given account.
   *
   * Replicates the data-fetching sequence that the LinkedHelper UI
   * performs before calling `mainWindow.startInstance()`:
   *
   * 1. Resolve renderer-side services via the webpack module registry.
   * 2. Refetch the full account object (with license, proxy, instance data).
   * 3. Read `userId` from the auth service and user profile from the user service.
   * 4. Fetch `frontendSettings` from the frontend-settings service.
   * 5. Transform the license into the format expected by the instance.
   * 6. Call `startInstance` with all populated fields.
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

          ${LauncherService.WEBPACK_INIT}
          if (!wpRequire) {
            return { success: false, error: 'webpack module registry not available' };
          }

          const authService = wpRequire(2742).authService;
          const userService = wpRequire(75381).userService;
          const liAccountsSvc = wpRequire(44354).runningLiAccountsService;
          const feSettingsSvc = wpRequire(81954).frontendSettingsService;

          // 2. Get the account object from the service cache.
          //    Using refetch: false because the LH backend API now
          //    rejects the embed format used by refetchLinkedInAccounts.
          //    The cache is populated by the launcher on startup, but
          //    may not be ready immediately — poll until available.
          let account = null;
          const cacheDeadline = Date.now() + 30000;
          while (Date.now() < cacheDeadline) {
            try {
              account = await liAccountsSvc.getLinkedInAccount({
                id: ${String(accountId)},
                refetch: false,
              });
              break;
            } catch {
              await new Promise(r => setTimeout(r, 500));
            }
          }
          if (!account) {
            return { success: false, error: 'Account not found in cache after 30s' };
          }

          // 3. Read userId and user profile
          const userId = authService.userId;
          const currentUser = userService.currentUserBS?.value
            ?? await userService.fetchUser(userId);

          // 4. Fetch frontend settings
          const frontendSettings = await feSettingsSvc.getFrontendSettings();

          // 5. Transform the license
          let license = null;
          if (account.license) {
            const lic = account.license;
            const ownerUid = lic.organizationId
              ? 'lh2:org:' + lic.organizationId
              : 'lh2:user:' + (lic.userId ?? userId);
            license = {
              id: lic.id,
              ownerUid: ownerUid,
              days: lic.days,
              expireAt: lic.expireAt,
              featureSet: lic.featureSet,
              subscriptionId: lic.subscriptionId,
              addedExpiryTimeAsSubscriptionGracePeriodMs:
                lic.addedExpiryTimeAsSubscriptionGracePeriodMs,
            };
          }

          // 6. Call startInstance with all populated fields
          await mainWindow.startInstance({
            linkedInAccount: account,
            instanceId: account.instance?.[0]?.id,
            proxy: account.proxy ?? null,
            license: license,
            userId: userId,
            frontendSettings: frontendSettings ?? {},
            lhAccount: {
              email: currentUser?.email ?? '',
              fullName: [currentUser?.firstName, currentUser?.lastName]
                .filter(Boolean).join(' '),
            },
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
   * List all accounts configured in LinkedHelper.
   *
   * Accounts are read from the renderer-side webpack service cache
   * (`runningLiAccountsService.extendedLinkedInAccountsBS`).  The
   * launcher populates this cache on startup via IPC; we poll until
   * it becomes available rather than calling `refetchLinkedInAccounts`
   * (whose backend API now rejects the old embed format with 400).
   */
  async listAccounts(): Promise<Account[]> {
    const client = this.ensureConnected();

    const accounts = await this.launcherEvaluate<Account[] | null>(
      client,
      `(async () => {
        ${LauncherService.WEBPACK_INIT}
        if (!wpRequire) return null;

        const svc = wpRequire(44354).runningLiAccountsService;

        // Poll until the cache is populated by the launcher's startup
        // process (same pattern as startInstance's account polling).
        const cacheDeadline = Date.now() + 30000;
        while (Date.now() < cacheDeadline) {
          const raw = svc.extendedLinkedInAccountsBS?.value;
          if (raw) {
            const entries = Array.isArray(raw) ? raw : Object.values(raw);
            if (entries.length > 0) {
              return entries.map(a => ({
                id: a.id,
                liId: a.id,
                name: a.fullName ?? '',
                email: a.email ?? undefined,
              }));
            }
          }
          await new Promise(r => setTimeout(r, 500));
        }
        return [];
      })()`,
      true,
    );

    if (accounts === null) {
      throw new WrongPortError(this.port);
    }

    return accounts;
  }

  /**
   * Query the active issues on a LinkedHelper instance.
   *
   * Issues are stored in `account.instance[0].issues.items[]` and
   * include both dialog issues (requiring button selection) and
   * critical error issues (informational blockers).
   */
  async getInstanceIssues(liId: number): Promise<InstanceIssue[]> {
    const client = this.ensureConnected();

    return this.launcherEvaluate<InstanceIssue[]>(
      client,
      `(async () => {
        const remote = require('@electron/remote');
        const mainWindow = remote.getGlobal('mainWindow');
        const getAccount = mainWindow.getLinkedInAccount
          ?? mainWindow.source?.linkedInAccounts?.getAccount;
        if (!getAccount) return [];
        const account = await getAccount({ id: ${String(liId)}, refetch: true });
        if (!account?.instance?.[0]) return [];
        const items = account.instance[0].issues?.items ?? [];
        return items.map(item => ({
          type: item.type,
          id: item.id,
          data: item.data,
        }));
      })()`,
      true,
    );
  }

  /**
   * Inspect the launcher DOM for a blocking popup overlay.
   *
   * Popups are managed via `popupBS` BehaviorSubject in the frontend.
   * A non-null backdrop element (`.Dialog_PopupBackdrop_cjqpj`) indicates
   * the UI is blocked.
   */
  async getPopupState(): Promise<PopupState | null> {
    const client = this.ensureConnected();

    return this.launcherEvaluate<PopupState | null>(
      client,
      `(() => {
        const backdrop = document.querySelector('.Dialog_PopupBackdrop_cjqpj');
        if (!backdrop) return null;
        const popup = document.querySelector('.Dialog_Popup_qpTvf');
        const body = popup?.querySelector('.Dialog_Body_RPquM');
        const controls = popup?.querySelector('.Dialog_Controls_oL8HA');
        return {
          blocked: true,
          message: body?.textContent?.trim() ?? undefined,
          closable: controls ? controls.querySelectorAll('button').length > 0 : false,
        };
      })()`,
    );
  }

  /**
   * Dismiss the blocking launcher popup by clicking its first button.
   *
   * Returns `true` if a popup was found and dismissed, `false` if no
   * dismissable popup was present.
   */
  async dismissPopup(): Promise<boolean> {
    const client = this.ensureConnected();

    return this.launcherEvaluate<boolean>(
      client,
      `(() => {
        const controls = document.querySelector('.Dialog_Controls_oL8HA');
        if (!controls) return false;
        const button = controls.querySelector('button');
        if (!button) return false;
        button.click();
        return true;
      })()`,
    );
  }

  /**
   * Check the overall UI health of a LinkedHelper instance.
   *
   * Combines instance issue queries with popup overlay detection
   * to produce an aggregated health status.
   */
  async checkUIHealth(liId: number): Promise<UIHealthStatus> {
    const [issues, popup] = await Promise.all([
      this.getInstanceIssues(liId),
      this.getPopupState(),
    ]);

    const healthy = issues.length === 0 && (popup === null || !popup.blocked);

    return { healthy, issues, popup, instancePopups: [] };
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
    return client.evaluate<T>(expression, awaitPromise, this.nodeContextId);
  }

  /**
   * Discover which CDP execution context provides `require()`.
   *
   * With `nodeIntegration` enabled, the default (main world) context
   * has `require()`.  When `nodeIntegration` is disabled (newer Electron
   * configurations), the Electron preload script still runs with Node.js
   * access in a separate isolated context.  This method probes all
   * available contexts to find one where `require()` is available.
   *
   * @returns The `contextId` for the Node.js-capable context, or
   *   `undefined` when the default context already has `require()`.
   * @throws {NodeIntegrationUnavailableError} if no context provides
   *   `require()`.
   */
  private async resolveNodeContextId(
    client: CDPClient,
  ): Promise<number | undefined> {
    // Try the default context first (backward-compatible path).
    try {
      const hasRequire = await client.evaluate<boolean>(
        "typeof require === 'function'",
      );
      if (hasRequire) return undefined;
    } catch {
      // Default context doesn't have require — probe other contexts.
    }

    // Collect all execution contexts via Runtime.enable.
    // CDP sends executionContextCreated events for existing contexts
    // before resolving the enable response, so by the time `send`
    // resolves all contexts have been collected.
    interface ExecutionContext {
      id: number;
      auxData?: { isDefault?: boolean };
    }
    const contexts: ExecutionContext[] = [];
    const handler = (params: unknown) => {
      const { context } = params as { context: ExecutionContext };
      contexts.push(context);
    };

    client.on("Runtime.executionContextCreated", handler);
    try {
      await client.send("Runtime.enable");
    } finally {
      client.off("Runtime.executionContextCreated", handler);
    }

    try {
      for (const ctx of contexts) {
        if (ctx.auxData?.isDefault) continue;
        try {
          const hasRequire = await client.evaluate<boolean>(
            "typeof require === 'function'",
            false,
            ctx.id,
          );
          if (hasRequire) return ctx.id;
        } catch {
          // This context doesn't support require — try next.
        }
      }
    } finally {
      await client.send("Runtime.disable").catch(() => {});
    }

    throw new NodeIntegrationUnavailableError();
  }
}
