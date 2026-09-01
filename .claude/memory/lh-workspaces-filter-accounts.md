---
name: LinkedHelper workspaces filter the account cache
description: On LinkedHelper 2.113.x+, runningLiAccountsService.extendedLinkedInAccountsBS only contains accounts in the selected workspace
type: project
originSessionId: 3aa5775a-fed4-4932-905a-c52788286d54
---
`runningLiAccountsService.extendedLinkedInAccountsBS.value` on LinkedHelper 2.113.x+ contains **only accounts in the currently selected workspace** — not all accounts the LH user can access. Partitions for accounts in other workspaces still exist on disk, but the cache is filtered.

**Why:** LinkedHelper introduced a workspace hierarchy (LH user → workspaces → LI accounts) where each LH user's selected workspace is stored server-side in `frontendSettings.selectedWorkspaceId` and acts as a view filter. Workspace access levels (`no_access`/`view_only`/`restricted`/`extended`/`owner`) gate operations: `view_only` and `no_access` cause the launcher to refuse `startInstance` with an "account-stopped:wrong-access:full" reason.

**How to apply:** `LauncherService.listAccounts()` defaults to the selected-workspace view for back-compat. Pass `{ includeAllWorkspaces: true }` to enumerate across every workspace the user belongs to (iterates `workspaceService.api.getWorkspaces()` + `getWorkspaceUserOwnedLiAccounts(wsUserId, { minLevel: "view_only" })`). Use `listWorkspaces()` to discover the user's workspaces. When gating operations, check `account.workspaceAccess?.level` and `canStartInstance(level)` from `@lhremote/core`.

Full background: `research/linkedhelper/architecture/WORKSPACES.md`, `research/linkedhelper/data/WORKSPACE-DATA-MODEL.md`.
