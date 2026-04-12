// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * LinkedHelper workspace types.
 *
 * Introduced in LinkedHelper 2.113.x. A workspace is a backend-side
 * container that groups LinkedIn accounts and tracks per-user access
 * levels. Each LH user can belong to multiple workspaces and has a
 * role (owner/admin/member/guest) in each. See
 * `research/linkedhelper/architecture/WORKSPACES.md` in the research
 * repo for the full architectural background.
 */

/** Role of an LH user within a workspace. Controls management permissions. */
export type WorkspaceUserRole = "owner" | "admin" | "member" | "guest";

/** Invitation status of a workspace user. */
export type WorkspaceInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled";

/**
 * Per-LinkedIn-account, per-workspace-user access level.
 *
 * Ordered enum: `owner` > `extended` > `restricted` > `view_only` > `no_access`.
 * The launcher treats `view_only` and `no_access` as blocking for
 * `startInstance` and will refuse to start an instance with a
 * `"account-stopped:wrong-access:full"` reason.
 */
export type WorkspaceAccessLevel =
  | "owner"
  | "extended"
  | "restricted"
  | "view_only"
  | "no_access";

/** Numeric order for {@link WorkspaceAccessLevel}, matching the launcher enum. */
export const WORKSPACE_ACCESS_LEVEL_ORDER: Readonly<
  Record<WorkspaceAccessLevel, number>
> = {
  owner: 3,
  extended: 2,
  restricted: 1,
  view_only: 0,
  no_access: -1,
};

/** Workspace access information attached to a LinkedIn account. */
export interface WorkspaceAccess {
  level: WorkspaceAccessLevel;
}

/** LH user's membership in a workspace. */
export interface WorkspaceUser {
  /** Workspace user ID (distinct from LH user ID). */
  id: number;
  /** LH user ID. */
  userId: number;
  workspaceId: number;
  role: WorkspaceUserRole;
  deleted: boolean;
}

/**
 * A LinkedHelper workspace.
 *
 * Workspaces are backend-only (not stored in the local SQLite database).
 * Only workspaces the current LH user belongs to are visible.
 */
export interface Workspace {
  id: number;
  name: string;
  deleted: boolean;
  /** Current user's membership in this workspace. */
  workspaceUser: WorkspaceUser;
  /** Whether this is the user's currently selected workspace. */
  selected: boolean;
}

/** Whether an account with the given access level can start an instance. */
export function canStartInstance(level: WorkspaceAccessLevel): boolean {
  return WORKSPACE_ACCESS_LEVEL_ORDER[level] >=
    WORKSPACE_ACCESS_LEVEL_ORDER.restricted;
}

/** `true` if `level` is `restricted` or higher. */
export function isRestrictedOrHigher(level: WorkspaceAccessLevel): boolean {
  return WORKSPACE_ACCESS_LEVEL_ORDER[level] >
    WORKSPACE_ACCESS_LEVEL_ORDER.view_only;
}

/** `true` if `level` is `view_only` or higher. */
export function isViewOnlyOrHigher(level: WorkspaceAccessLevel): boolean {
  return WORKSPACE_ACCESS_LEVEL_ORDER[level] >=
    WORKSPACE_ACCESS_LEVEL_ORDER.view_only;
}

/** `true` if `level` is `extended` or `owner`. */
export function isOwnerOrExtended(level: WorkspaceAccessLevel): boolean {
  return WORKSPACE_ACCESS_LEVEL_ORDER[level] >
    WORKSPACE_ACCESS_LEVEL_ORDER.restricted;
}
