// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import {
  canStartInstance,
  isOwnerOrExtended,
  isRestrictedOrHigher,
  isViewOnlyOrHigher,
  type Workspace,
  WORKSPACE_ACCESS_LEVEL_ORDER,
  type WorkspaceAccessLevel,
} from "./workspace.js";

const ALL_LEVELS: WorkspaceAccessLevel[] = [
  "no_access",
  "view_only",
  "restricted",
  "extended",
  "owner",
];

describe("WORKSPACE_ACCESS_LEVEL_ORDER", () => {
  it("matches the launcher's numeric enum", () => {
    expect(WORKSPACE_ACCESS_LEVEL_ORDER.owner).toBe(3);
    expect(WORKSPACE_ACCESS_LEVEL_ORDER.extended).toBe(2);
    expect(WORKSPACE_ACCESS_LEVEL_ORDER.restricted).toBe(1);
    expect(WORKSPACE_ACCESS_LEVEL_ORDER.view_only).toBe(0);
    expect(WORKSPACE_ACCESS_LEVEL_ORDER.no_access).toBe(-1);
  });

  it("is strictly ordered", () => {
    expect(WORKSPACE_ACCESS_LEVEL_ORDER.owner)
      .toBeGreaterThan(WORKSPACE_ACCESS_LEVEL_ORDER.extended);
    expect(WORKSPACE_ACCESS_LEVEL_ORDER.extended)
      .toBeGreaterThan(WORKSPACE_ACCESS_LEVEL_ORDER.restricted);
    expect(WORKSPACE_ACCESS_LEVEL_ORDER.restricted)
      .toBeGreaterThan(WORKSPACE_ACCESS_LEVEL_ORDER.view_only);
    expect(WORKSPACE_ACCESS_LEVEL_ORDER.view_only)
      .toBeGreaterThan(WORKSPACE_ACCESS_LEVEL_ORDER.no_access);
  });
});

describe("canStartInstance", () => {
  it("allows restricted, extended, and owner", () => {
    expect(canStartInstance("restricted")).toBe(true);
    expect(canStartInstance("extended")).toBe(true);
    expect(canStartInstance("owner")).toBe(true);
  });

  it("blocks view_only and no_access", () => {
    expect(canStartInstance("view_only")).toBe(false);
    expect(canStartInstance("no_access")).toBe(false);
  });

  it("is a total function on every access level", () => {
    for (const level of ALL_LEVELS) {
      expect(typeof canStartInstance(level)).toBe("boolean");
    }
  });
});

describe("isRestrictedOrHigher", () => {
  it("is true for restricted, extended, owner", () => {
    expect(isRestrictedOrHigher("restricted")).toBe(true);
    expect(isRestrictedOrHigher("extended")).toBe(true);
    expect(isRestrictedOrHigher("owner")).toBe(true);
  });

  it("is false for view_only and no_access", () => {
    expect(isRestrictedOrHigher("view_only")).toBe(false);
    expect(isRestrictedOrHigher("no_access")).toBe(false);
  });
});

describe("isViewOnlyOrHigher", () => {
  it("is true for view_only and above", () => {
    expect(isViewOnlyOrHigher("view_only")).toBe(true);
    expect(isViewOnlyOrHigher("restricted")).toBe(true);
    expect(isViewOnlyOrHigher("extended")).toBe(true);
    expect(isViewOnlyOrHigher("owner")).toBe(true);
  });

  it("is false for no_access", () => {
    expect(isViewOnlyOrHigher("no_access")).toBe(false);
  });
});

describe("isOwnerOrExtended", () => {
  it("is true only for extended and owner", () => {
    expect(isOwnerOrExtended("owner")).toBe(true);
    expect(isOwnerOrExtended("extended")).toBe(true);
  });

  it("is false for restricted and below", () => {
    expect(isOwnerOrExtended("restricted")).toBe(false);
    expect(isOwnerOrExtended("view_only")).toBe(false);
    expect(isOwnerOrExtended("no_access")).toBe(false);
  });
});

describe("Workspace type", () => {
  it("allows a full workspace shape", () => {
    const ws: Workspace = {
      id: 20338,
      name: "PELYKH Consulting",
      deleted: false,
      workspaceUser: {
        id: 33440,
        userId: 438509,
        workspaceId: 20338,
        role: "owner",
        deleted: false,
      },
      selected: true,
    };
    expect(ws.id).toBe(20338);
    expect(ws.workspaceUser.role).toBe("owner");
    expect(ws.selected).toBe(true);
  });
});
