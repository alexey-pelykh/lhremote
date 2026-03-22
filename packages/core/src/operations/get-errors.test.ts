// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/launcher.js", () => ({
  LauncherService: vi.fn(),
}));

vi.mock("../cdp/index.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../services/instance.js", () => ({
  InstanceService: vi.fn(),
}));

import { discoverTargets } from "../cdp/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { InstanceService } from "../services/instance.js";
import { LauncherService } from "../services/launcher.js";
import type { UIHealthStatus } from "../types/index.js";
import { getErrors } from "./get-errors.js";

describe("getErrors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no instance targets
    vi.mocked(discoverTargets).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockLauncher(health: UIHealthStatus) {
    const mock = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      checkUIHealth: vi.fn().mockResolvedValue(health),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mock as unknown as LauncherService;
    });
    return mock;
  }

  it("returns healthy status when no issues, popups, or instance popups", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    mockLauncher({ healthy: true, issues: [], popup: null, instancePopups: [] });

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.healthy).toBe(true);
    expect(result.accountId).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.popup).toBeNull();
    expect(result.instancePopups).toEqual([]);
  });

  it("returns blocked status with dialog issues", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    mockLauncher({
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
      instancePopups: [],
    });

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.healthy).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.type).toBe("dialog");
  });

  it("returns blocked status with popup overlay", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    mockLauncher({
      healthy: false,
      issues: [],
      popup: { blocked: true, message: "Network issue", closable: false },
      instancePopups: [],
    });

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.healthy).toBe(false);
    expect(result.popup?.blocked).toBe(true);
    expect(result.popup?.message).toBe("Network issue");
  });

  it("passes connection options to resolveAccount", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    mockLauncher({ healthy: true, issues: [], popup: null, instancePopups: [] });

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

    const mock = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      checkUIHealth: vi.fn().mockRejectedValue(new Error("CDP failure")),
    };
    vi.mocked(LauncherService).mockImplementation(function () {
      return mock as unknown as LauncherService;
    });

    await expect(getErrors({ cdpPort: 9222 })).rejects.toThrow("CDP failure");
    expect(mock.disconnect).toHaveBeenCalledOnce();
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(
      new Error("connection refused"),
    );

    await expect(getErrors({ cdpPort: 9222 })).rejects.toThrow(
      "connection refused",
    );
  });

  it("includes instance popups when instance is running", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    mockLauncher({ healthy: true, issues: [], popup: null, instancePopups: [] });

    vi.mocked(discoverTargets).mockResolvedValue([
      { id: "t1", type: "page", title: "LinkedIn", url: "https://www.linkedin.com/feed/", description: "", devtoolsFrontendUrl: "", webSocketDebuggerUrl: "" },
      { id: "t2", type: "page", title: "LH", url: "file:///index.html", description: "", devtoolsFrontendUrl: "", webSocketDebuggerUrl: "" },
    ]);

    const mockInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getInstancePopups: vi.fn().mockResolvedValue([
        { title: "Failed to initialize UI", description: "AsyncHandlerError", closable: true },
      ]),
    };
    vi.mocked(InstanceService).mockImplementation(function () {
      return mockInstance as unknown as InstanceService;
    });

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.instancePopups).toHaveLength(1);
    expect(result.instancePopups[0]?.title).toBe("Failed to initialize UI");
    expect(result.healthy).toBe(false);
  });

  it("marks unhealthy when instance popups are present even if launcher is healthy", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    mockLauncher({ healthy: true, issues: [], popup: null, instancePopups: [] });

    vi.mocked(discoverTargets).mockResolvedValue([
      { id: "t1", type: "page", title: "LinkedIn", url: "https://www.linkedin.com/feed/", description: "", devtoolsFrontendUrl: "", webSocketDebuggerUrl: "" },
      { id: "t2", type: "page", title: "LH", url: "file:///index.html", description: "", devtoolsFrontendUrl: "", webSocketDebuggerUrl: "" },
    ]);

    const mockInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getInstancePopups: vi.fn().mockResolvedValue([
        { title: "Error popup", closable: false },
      ]),
    };
    vi.mocked(InstanceService).mockImplementation(function () {
      return mockInstance as unknown as InstanceService;
    });

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.healthy).toBe(false);
    expect(result.instancePopups).toHaveLength(1);
  });

  it("returns empty instancePopups when instance is not running", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    mockLauncher({ healthy: true, issues: [], popup: null, instancePopups: [] });

    // Only launcher target, no instance targets
    vi.mocked(discoverTargets).mockResolvedValue([
      { id: "t1", type: "page", title: "Launcher", url: "file:///launcher.html", description: "", devtoolsFrontendUrl: "", webSocketDebuggerUrl: "" },
    ]);

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.instancePopups).toEqual([]);
    expect(result.healthy).toBe(true);
  });

  it("returns empty instancePopups when target discovery fails", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    mockLauncher({ healthy: true, issues: [], popup: null, instancePopups: [] });

    vi.mocked(discoverTargets).mockRejectedValue(new Error("connection reset"));

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.instancePopups).toEqual([]);
    expect(result.healthy).toBe(true);
  });

  it("disconnects instance service even when getInstancePopups fails", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    mockLauncher({ healthy: true, issues: [], popup: null, instancePopups: [] });

    vi.mocked(discoverTargets).mockResolvedValue([
      { id: "t1", type: "page", title: "LinkedIn", url: "https://www.linkedin.com/feed/", description: "", devtoolsFrontendUrl: "", webSocketDebuggerUrl: "" },
      { id: "t2", type: "page", title: "LH", url: "file:///index.html", description: "", devtoolsFrontendUrl: "", webSocketDebuggerUrl: "" },
    ]);

    const mockInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getInstancePopups: vi.fn().mockRejectedValue(new Error("DOM error")),
    };
    vi.mocked(InstanceService).mockImplementation(function () {
      return mockInstance as unknown as InstanceService;
    });

    const result = await getErrors({ cdpPort: 9222 });

    expect(result.instancePopups).toEqual([]);
    expect(mockInstance.disconnect).toHaveBeenCalledOnce();
  });
});
