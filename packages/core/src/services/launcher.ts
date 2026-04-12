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
  Workspace,
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
   * CDP snippet that resolves LinkedHelper frontend service singletons
   * via the webpack module registry and exposes them on `lhSvc`.
   *
   * The snippet is designed to be cache-aware: the first invocation
   * per page navigation performs a marker-based scan of the webpack
   * module registry and stashes the resolved services on
   * `window.__lhrServices`. Subsequent invocations read from the cache.
   *
   * **Why marker-based?** Webpack module IDs are not stable across
   * LinkedHelper releases. Between v2.113.11 and v2.113.28, three of
   * the four service modules we depend on shifted IDs. The only
   * reliable way to locate services is to scan for module exports
   * with characteristic fields (e.g. `_workspacesBS` for the workspace
   * service). See `research/linkedhelper/architecture/V2113-WEBPACK-MODULE-IDS.md`.
   *
   * Each resolved service is exposed under a dotless alias for quick
   * access in subsequent expressions:
   *
   * - `lhSvc.auth` — authService (userId, role, isLoggedIn)
   * - `lhSvc.user` — userService (currentUserBS, fetchUser)
   * - `lhSvc.runningLi` — runningLiAccountsService
   *   (extendedLinkedInAccountsBS, getLinkedInAccount, startLinkedInAccountLocal)
   * - `lhSvc.feSettings` — frontendSettingsService (getFrontendSettings, _cacheBS)
   * - `lhSvc.workspace` — workspaceService
   *   (_workspacesBS, _selectedWorkspaceBS, api, refreshWorkspaces); may be
   *   `null` on LinkedHelper versions that predate workspaces
   *
   * Callers must check `lhSvc` for null and handle the failure case.
   */
  private static readonly LH_SERVICES_INIT = `
    const _wpDeadline = Date.now() + 15000;
    while (!window.webpackChunk_linked_helper_front && Date.now() < _wpDeadline) {
      await new Promise(r => setTimeout(r, 250));
    }
    let lhSvc = null;
    if (window.__lhrServices) {
      lhSvc = window.__lhrServices;
    } else if (window.webpackChunk_linked_helper_front) {
      let _wpReq = null;
      window.webpackChunk_linked_helper_front.push(
        [[Symbol()], {}, (req) => { _wpReq = req; }]
      );
      if (_wpReq) {
        const _specs = {
          auth:        { exportKey: 'authService',              markers: ['userId', 'role'] },
          user:        { exportKey: 'default',                  markers: ['currentUserBS', 'fetchUser'] },
          runningLi:   { exportKey: 'runningLiAccountsService', markers: ['extendedLinkedInAccountsBS', 'getLinkedInAccount'] },
          feSettings:  { exportKey: 'frontendSettingsService',  markers: ['getFrontendSettings', '_cacheBS'] },
          workspace:   { exportKey: 'A',                        markers: ['_workspacesBS', '_selectedWorkspaceBS'] },
        };
        const _resolved = {};
        for (const _id of Object.keys(_wpReq.m || {})) {
          let _mod;
          try { _mod = _wpReq(_id); } catch (_e) { continue; }
          if (!_mod) continue;
          for (const _name of Object.keys(_specs)) {
            if (_resolved[_name]) continue;
            const _spec = _specs[_name];
            const _v = _mod[_spec.exportKey];
            if (_v && typeof _v === 'object' && _spec.markers.every(m => m in _v)) {
              _resolved[_name] = _v;
              continue;
            }
            for (const _k of Object.keys(_mod)) {
              const _w = _mod[_k];
              if (!_w || typeof _w !== 'object') continue;
              if (_spec.markers.every(m => m in _w)) {
                _resolved[_name] = _w;
                break;
              }
            }
          }
          if (Object.keys(_resolved).length === Object.keys(_specs).length) break;
        }
        if (_resolved.auth && _resolved.user && _resolved.runningLi && _resolved.feSettings) {
          // workspace may legitimately be missing on pre-2.113.x launchers
          lhSvc = {
            auth: _resolved.auth,
            user: _resolved.user,
            runningLi: _resolved.runningLi,
            feSettings: _resolved.feSettings,
            workspace: _resolved.workspace || null,
          };
          window.__lhrServices = lhSvc;
        }
      }
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

          ${LauncherService.LH_SERVICES_INIT}
          if (!lhSvc) {
            return { success: false, error: 'LinkedHelper frontend services not available (webpack registry empty or core services missing)' };
          }

          const authService = lhSvc.auth;
          const userService = lhSvc.user;
          const liAccountsSvc = lhSvc.runningLi;
          const feSettingsSvc = lhSvc.feSettings;

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
            return { success: false, error: 'Account not found in cache after 30s. On v2.113.x+, the running-accounts cache is filtered to the selected workspace; the account may be in a different workspace.' };
          }

          // 2a. Gate on workspace access level (v2.113.x+).
          //     The launcher refuses to start instances with view_only
          //     or no_access, so fail fast with a clear error.
          const accessLevel = account.workspaceAccess?.level;
          if (accessLevel === 'view_only' || accessLevel === 'no_access') {
            return { success: false, error: 'Workspace access level "' + accessLevel + '" does not allow starting an instance (requires restricted or higher)' };
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
   * List LinkedHelper accounts visible to the current LH user.
   *
   * Default behaviour (back-compat with pre-workspace clients):
   * returns only accounts in the **currently selected workspace** —
   * the same set the launcher UI shows. This reflects the state of
   * `runningLiAccountsService.extendedLinkedInAccountsBS`, which
   * LinkedHelper 2.113.x filters to the selected workspace.
   *
   * With `{ includeAllWorkspaces: true }`, queries every workspace
   * the user belongs to and returns the union of owned LinkedIn
   * accounts (requires `workspaceService.api.getWorkspaceUserOwnedLiAccounts`,
   * available only on v2.113.x+). Use this when you need to drive
   * accounts that live outside the currently selected workspace.
   *
   * @param options.includeAllWorkspaces If `true`, enumerate all
   *   workspaces and list accounts across them. Defaults to `false`.
   */
  async listAccounts(options?: {
    includeAllWorkspaces?: boolean;
  }): Promise<Account[]> {
    const client = this.ensureConnected();

    const includeAllWorkspaces = options?.includeAllWorkspaces ?? false;

    const accounts = await this.launcherEvaluate<Account[] | null>(
      client,
      `(async () => {
        ${LauncherService.LH_SERVICES_INIT}
        if (!lhSvc) return null;

        const svc = lhSvc.runningLi;
        const wsSvc = lhSvc.workspace;
        const includeAll = ${String(includeAllWorkspaces)};

        const mapAccount = (a, ws) => ({
          id: a.id,
          liId: a.id,
          name: a.fullName ?? '',
          email: a.email ?? undefined,
          workspaceId: a.workspaceId ?? ws?.id,
          workspaceName: ws?.name,
          workspaceAccess: a.workspaceAccess
            ? { level: a.workspaceAccess.level }
            : undefined,
        });

        if (includeAll && wsSvc) {
          // Cross-workspace listing: iterate workspaces and call
          // getWorkspaceUserOwnedLiAccounts(wsUserId, { minLevel: 'view_only' })
          // to get everything the current user can see.
          try {
            const wsResult = await wsSvc.api.getWorkspaces(
              { userId: lhSvc.auth.userId, deleted: false },
              false,
            );
            const workspaces = wsResult?.data ?? [];
            const seen = new Map();
            for (const ws of workspaces) {
              if (!ws.workspaceUser) continue;
              try {
                const res = await wsSvc.api.getWorkspaceUserOwnedLiAccounts(
                  ws.workspaceUser.id,
                  { minLevel: 'view_only' },
                );
                for (const a of res?.data ?? []) {
                  if (seen.has(a.id)) continue;
                  seen.set(a.id, mapAccount(a, ws));
                }
              } catch (_e) {
                // 403/404 on a workspace is tolerable; skip it
              }
            }
            return Array.from(seen.values());
          } catch (e) {
            return { __error: 'cross-workspace listing failed: ' + e.message };
          }
        }

        // Default: read from the selected-workspace cache the launcher
        // maintains. Poll until the cache is populated by the startup
        // process.
        const selectedWs = wsSvc?._selectedWorkspaceBS?.value ?? null;
        const cacheDeadline = Date.now() + 30000;
        while (Date.now() < cacheDeadline) {
          const raw = svc.extendedLinkedInAccountsBS?.value;
          if (raw) {
            const entries = Array.isArray(raw) ? raw : Object.values(raw);
            if (entries.length > 0) {
              return entries.map(a => mapAccount(a, selectedWs));
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

    if (!Array.isArray(accounts) && typeof accounts === "object") {
      const errObj = accounts as { __error?: string };
      if (errObj.__error) {
        throw new ServiceError(errObj.__error);
      }
    }

    return accounts;
  }

  /**
   * List workspaces the current LH user belongs to.
   *
   * Workspaces are a LinkedHelper 2.113.x feature. On earlier
   * versions this method returns an empty array (the workspace
   * service module is absent). On v2.113.x+ it returns every
   * workspace the user is a member of, with the user's role and
   * an indication of which workspace is currently selected.
   *
   * @see `research/linkedhelper/architecture/WORKSPACES.md`
   */
  async listWorkspaces(): Promise<Workspace[]> {
    const client = this.ensureConnected();

    const workspaces = await this.launcherEvaluate<Workspace[] | null>(
      client,
      `(async () => {
        ${LauncherService.LH_SERVICES_INIT}
        if (!lhSvc) return null;
        const wsSvc = lhSvc.workspace;
        if (!wsSvc) return [];

        // Prefer the in-memory cache if populated; otherwise refetch.
        let cached = wsSvc._workspacesBS?.value ?? null;
        if (!cached) {
          try { await wsSvc.refreshWorkspaces(); } catch (_e) {}
          cached = wsSvc._workspacesBS?.value ?? null;
        }
        if (!cached) {
          // Fall back to a direct API call
          try {
            const res = await wsSvc.api.getWorkspaces(
              { userId: lhSvc.auth.userId, deleted: false },
              false,
            );
            cached = res?.data ?? [];
          } catch (_e) {
            cached = [];
          }
        }

        const selectedId = wsSvc._selectedWorkspaceBS?.value?.id ?? null;
        return (cached || []).map(w => ({
          id: w.id,
          name: w.name,
          deleted: !!w.deleted,
          workspaceUser: w.workspaceUser ? {
            id: w.workspaceUser.id,
            userId: w.workspaceUser.userId,
            workspaceId: w.workspaceUser.workspaceId,
            role: w.workspaceUser.role,
            deleted: !!w.workspaceUser.deleted,
          } : null,
          selected: w.id === selectedId,
        })).filter(w => w.workspaceUser !== null);
      })()`,
      true,
    );

    if (workspaces === null) {
      throw new WrongPortError(this.port);
    }

    // Drop the null-filter sentinel we used inside the evaluated snippet.
    return workspaces as Workspace[];
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
   * Dismiss an active dialog issue on a LinkedHelper instance.
   *
   * Dialogs appear as "issues" on the instance (e.g. when the launcher
   * sends a close command).  Each dialog exposes one or more control
   * buttons identified by `buttonId`.  This method programmatically
   * clicks the specified button to dismiss the dialog.
   *
   * @param liId       LinkedIn account ID that owns the instance.
   * @param dialogId   The dialog issue ID (from {@link InstanceIssue}).
   * @param buttonId   The control button ID to click (from `DialogIssueData.options.controls[].id`).
   */
  async dismissInstanceDialog(
    liId: number,
    dialogId: string,
    buttonId: string,
  ): Promise<void> {
    const client = this.ensureConnected();

    await this.launcherEvaluate(
      client,
      `(async () => {
        const remote = require('@electron/remote');
        const mainWindow = remote.getGlobal('mainWindow');
        return await mainWindow.instanceManager.closeInstanceDialog(
          ${String(liId)},
          ${JSON.stringify(dialogId)},
          { buttonId: ${JSON.stringify(buttonId)} }
        );
      })()`,
      true,
    );
  }

  /**
   * Stop a running instance, automatically dismissing the confirmation
   * dialog that LinkedHelper may show.
   *
   * Calls {@link stopInstance}, then polls {@link getInstanceIssues} at
   * 500 ms intervals for up to 10 s.  When a dialog issue appears, its
   * first control button is clicked via {@link dismissInstanceDialog}.
   * If no dialog surfaces within the timeout the method returns normally.
   *
   * @param liId  LinkedIn account ID that owns the instance.
   */
  async stopInstanceWithDialogDismissal(liId: number): Promise<void> {
    await this.stopInstance(liId);

    const POLL_INTERVAL = 500;
    const POLL_TIMEOUT = 10_000;
    const deadline = Date.now() + POLL_TIMEOUT;

    while (Date.now() < deadline) {
      const issues = await this.getInstanceIssues(liId);
      const dialog = issues.find((i) => i.type === "dialog");
      if (dialog) {
        const firstControl = dialog.data.options.controls[0];
        if (firstControl) {
          await this.dismissInstanceDialog(liId, dialog.id, firstControl.id);
        }
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
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
