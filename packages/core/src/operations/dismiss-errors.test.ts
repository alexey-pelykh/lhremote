// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/launcher.js", () => ({
  LauncherService: vi.fn(),
}));

vi.mock("../services/instance.js", () => ({
  InstanceService: vi.fn(),
}));

import { resolveAccount } from "../services/account-resolution.js";
import { InstanceService } from "../services/instance.js";
import { LauncherService } from "../services/launcher.js";
import { dismissErrors } from "./dismiss-errors.js";

describe("dismissErrors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns zero counts when no popups present", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissPopup: vi.fn().mockResolvedValue(false),
      getPopupState: vi.fn().mockResolvedValue(null),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    const mockInstance = {
      connectUiOnly: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissInstancePopups: vi.fn().mockResolvedValue({ dismissed: 0, nonDismissable: 0 }),
    };
    vi.mocked(InstanceService).mockImplementation(function () {
      return mockInstance as unknown as InstanceService;
    });

    const result = await dismissErrors({ cdpPort: 9222 });

    expect(result.accountId).toBe(1);
    expect(result.dismissed).toBe(0);
    expect(result.nonDismissable).toBe(0);
  });

  it("dismisses launcher popup and instance popups", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissPopup: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    const mockInstance = {
      connectUiOnly: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissInstancePopups: vi.fn().mockResolvedValue({ dismissed: 2, nonDismissable: 0 }),
    };
    vi.mocked(InstanceService).mockImplementation(function () {
      return mockInstance as unknown as InstanceService;
    });

    const result = await dismissErrors({ cdpPort: 9222 });

    expect(result.dismissed).toBe(3);
    expect(result.nonDismissable).toBe(0);
  });

  it("reports non-dismissable launcher popup", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissPopup: vi.fn().mockResolvedValue(false),
      getPopupState: vi.fn().mockResolvedValue({ blocked: true, closable: false }),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    const mockInstance = {
      connectUiOnly: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissInstancePopups: vi.fn().mockResolvedValue({ dismissed: 0, nonDismissable: 1 }),
    };
    vi.mocked(InstanceService).mockImplementation(function () {
      return mockInstance as unknown as InstanceService;
    });

    const result = await dismissErrors({ cdpPort: 9222 });

    expect(result.dismissed).toBe(0);
    expect(result.nonDismissable).toBe(2);
  });

  it("passes connection options to resolveAccount", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissPopup: vi.fn().mockResolvedValue(false),
      getPopupState: vi.fn().mockResolvedValue(null),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    const mockInstance = {
      connectUiOnly: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissInstancePopups: vi.fn().mockResolvedValue({ dismissed: 0, nonDismissable: 0 }),
    };
    vi.mocked(InstanceService).mockImplementation(function () {
      return mockInstance as unknown as InstanceService;
    });

    await dismissErrors({
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("works when LinkedIn webview is absent (partial start)", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissPopup: vi.fn().mockResolvedValue(false),
      getPopupState: vi.fn().mockResolvedValue(null),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    const mockInstance = {
      connectUiOnly: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissInstancePopups: vi.fn().mockResolvedValue({ dismissed: 1, nonDismissable: 0 }),
    };
    vi.mocked(InstanceService).mockImplementation(function () {
      return mockInstance as unknown as InstanceService;
    });

    const result = await dismissErrors({ cdpPort: 9222 });

    expect(mockInstance.connectUiOnly).toHaveBeenCalledOnce();
    expect(result.dismissed).toBe(1);
    expect(result.nonDismissable).toBe(0);
  });

  it("disconnects services even on error", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      dismissPopup: vi.fn().mockRejectedValue(new Error("CDP failure")),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    await expect(dismissErrors({ cdpPort: 9222 })).rejects.toThrow("CDP failure");
    expect(mockLauncher.disconnect).toHaveBeenCalledOnce();
  });
});
