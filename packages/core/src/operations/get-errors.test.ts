// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/launcher.js", () => ({
  LauncherService: vi.fn(),
}));

import { resolveAccount } from "../services/account-resolution.js";
import { LauncherService } from "../services/launcher.js";
import type { UIHealthStatus } from "../types/index.js";
import { getErrors } from "./get-errors.js";

describe("getErrors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns healthy status when no issues or popups", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const health: UIHealthStatus = {
      healthy: true,
      issues: [],
      popup: null,
    };

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      checkUIHealth: vi.fn().mockResolvedValue(health),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.healthy).toBe(true);
    expect(result.accountId).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.popup).toBeNull();
  });

  it("returns blocked status with dialog issues", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const health: UIHealthStatus = {
      healthy: false,
      issues: [
        {
          type: "dialog",
          id: "d1",
          data: {
            id: "d1",
            options: {
              message: "Instance closed from launcher",
              controls: [{ id: "ok", text: "OK" }],
            },
          },
        },
      ],
      popup: null,
    };

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      checkUIHealth: vi.fn().mockResolvedValue(health),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.healthy).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.type).toBe("dialog");
  });

  it("returns blocked status with popup overlay", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const health: UIHealthStatus = {
      healthy: false,
      issues: [],
      popup: { blocked: true, message: "Network issue", closable: false },
    };

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      checkUIHealth: vi.fn().mockResolvedValue(health),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.healthy).toBe(false);
    expect(result.popup?.blocked).toBe(true);
    expect(result.popup?.message).toBe("Network issue");
  });

  it("passes connection options to resolveAccount", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      checkUIHealth: vi.fn().mockResolvedValue({
        healthy: true,
        issues: [],
        popup: null,
      }),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    await getErrors({
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("disconnects launcher even on error", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);

    const mockLauncher = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      checkUIHealth: vi.fn().mockRejectedValue(new Error("CDP failure")),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mockLauncher as unknown as LauncherService;
    });

    await expect(getErrors({ cdpPort: 9222 })).rejects.toThrow("CDP failure");
    expect(mockLauncher.disconnect).toHaveBeenCalledOnce();
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(
      new Error("connection refused"),
    );

    await expect(getErrors({ cdpPort: 9222 })).rejects.toThrow(
      "connection refused",
    );
  });
});
