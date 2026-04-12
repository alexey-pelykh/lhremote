// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { WorkspaceAccess } from "./workspace.js";

/**
 * A LinkedHelper account.
 *
 * Each account corresponds to a LinkedIn identity managed by
 * LinkedHelper and has its own database partition.
 *
 * Starting with LinkedHelper 2.113.x, every account belongs to a
 * workspace and exposes a per-user access level. See
 * {@link Account.workspaceId} and {@link Account.workspaceAccess}.
 */
export interface Account {
  id: number;
  liId: number;
  name: string;
  email?: string | undefined;
  /**
   * ID of the workspace that owns this account (v2.113.x+).
   *
   * Omitted when the underlying LinkedHelper version predates workspaces
   * or when the account was discovered without a workspace context.
   */
  workspaceId?: number | undefined;
  /**
   * Name of the owning workspace (v2.113.x+), included as a convenience
   * so that consumers do not need a separate `listWorkspaces` call.
   */
  workspaceName?: string | undefined;
  /**
   * Per-user access level on this account (v2.113.x+).
   *
   * `view_only` and `no_access` mean the current LH user cannot
   * start an instance for this account — the launcher will refuse
   * with a "wrong-access:full" stopping reason.
   */
  workspaceAccess?: WorkspaceAccess | undefined;
}
