// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH
//
// Unit tests for LauncherService.reconnect().
// Mocks the CDP layer so no real network I/O occurs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the CDP dependencies before importing LauncherService
// ---------------------------------------------------------------------------

vi.mock("../cdp/app-discovery.js", () => ({
  resolveAppPort: vi.fn(),
  findApp: vi.fn().mockResolvedValue([]),
  REACHABILITY_RETRY_TIMEOUT: 30_000,
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mock declarations so hoisting works)
// ---------------------------------------------------------------------------

import { resolveAppPort, findApp } from "../cdp/app-discovery.js";
import { CDPClient } from "../cdp/client.js";
import { LauncherService } from "./launcher.js";
import {
  LinkedHelperNotRunningError,
  LinkedHelperUnreachableError,
  WrongPortError,
} from "./errors.js";

const mockResolveAppPort = vi.mocked(resolveAppPort);
const mockFindApp = vi.mocked(findApp);
const MockCDPClient = vi.mocked(CDPClient);

// ---------------------------------------------------------------------------
// Helper: build a fake CDPClient that passes the bindLauncherClient checks
// ---------------------------------------------------------------------------

type MockClientOptions = {
  connectError?: Error;
  isLauncher?: boolean;
};

function makeMockCDPClient({ connectError, isLauncher = true }: MockClientOptions = {}) {
  const mockClient = {
    connect: connectError
      ? vi.fn().mockRejectedValue(connectError)
      : vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    // evaluate is called twice inside bindLauncherClient:
    //  1. resolveNodeContextId → "typeof require === 'function'" → true
    //  2. isLauncher check → "electronStore" → `isLauncher`
    evaluate: vi.fn().mockImplementation((expr: string) => {
      if (typeof expr === "string" && expr.includes("electronStore")) {
        return Promise.resolve(isLauncher);
      }
      // default for context probes
      return Promise.resolve(true);
    }),
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    isConnected: true,
  };
  MockCDPClient.mockImplementation(function() { return mockClient as unknown as CDPClient; });
  return mockClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LauncherService.reconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindApp.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-discovers the launcher port and reconnects successfully", async () => {
    mockResolveAppPort.mockResolvedValue(50123);
    makeMockCDPClient({ isLauncher: true });

    const launcher = new LauncherService(9222);
    await launcher.reconnect();

    // CDPClient must have been constructed with the newly discovered port.
    expect(MockCDPClient).toHaveBeenCalledWith(
      50123,
      expect.objectContaining({ host: "127.0.0.1" }),
    );
    expect(launcher.isConnected).toBe(true);
  });

  it("handles port change: 9222 → different port", async () => {
    // Launcher originally at 9222 but now bound on 49238.
    mockResolveAppPort.mockResolvedValue(49238);
    makeMockCDPClient({ isLauncher: true });

    const launcher = new LauncherService(9222);
    await launcher.reconnect();

    expect(MockCDPClient).toHaveBeenCalledWith(
      49238,
      expect.objectContaining({ host: "127.0.0.1" }),
    );
  });

  it("disconnects the previous client before reconnecting", async () => {
    mockResolveAppPort.mockResolvedValue(50000);
    const firstClient = makeMockCDPClient({ isLauncher: true });

    // Simulate a connected launcher so there is something to disconnect.
    const launcher = new LauncherService(9222);
    // Manually inject the first client to simulate a prior connection.
    Object.assign(launcher, { client: firstClient });

    await launcher.reconnect();

    expect(firstClient.disconnect).toHaveBeenCalledOnce();
  });

  it("throws LinkedHelperNotRunningError when no launcher process is found", async () => {
    mockResolveAppPort.mockRejectedValue(new LinkedHelperNotRunningError());

    const launcher = new LauncherService(9222);
    await expect(launcher.reconnect()).rejects.toThrow(
      LinkedHelperNotRunningError,
    );
    expect(launcher.isConnected).toBe(false);
  });

  it("throws LinkedHelperUnreachableError (structured) when cap is exceeded", async () => {
    const structuredErr = new LinkedHelperUnreachableError([
      { pid: 1234, cdpPort: null, connectable: false, role: "launcher" },
    ]);
    mockResolveAppPort.mockRejectedValue(structuredErr);

    const launcher = new LauncherService(9222);
    const err = await launcher.reconnect().catch((e: unknown) => e);

    // Must be a ServiceError subclass, not a raw Error.
    expect(err).toBeInstanceOf(LinkedHelperUnreachableError);
    expect((err as LinkedHelperUnreachableError).name).toBe(
      "LinkedHelperUnreachableError",
    );
  });

  it("throws WrongPortError when discovered port does not expose launcher API", async () => {
    mockResolveAppPort.mockResolvedValue(50200);
    makeMockCDPClient({ isLauncher: false });

    const launcher = new LauncherService(9222);
    await expect(launcher.reconnect()).rejects.toThrow(WrongPortError);
    expect(launcher.isConnected).toBe(false);
  });

  it("passes timeoutMs to resolveAppPort", async () => {
    mockResolveAppPort.mockResolvedValue(50000);
    makeMockCDPClient({ isLauncher: true });

    const launcher = new LauncherService(9222);
    await launcher.reconnect({ timeoutMs: 10_000 });

    expect(mockResolveAppPort).toHaveBeenCalledWith("launcher", 10_000);
  });

  it("reads LHREMOTE_LAUNCHER_RECOVERY_TIMEOUT_MS env var for default timeout", async () => {
    vi.stubEnv("LHREMOTE_LAUNCHER_RECOVERY_TIMEOUT_MS", "12000");
    mockResolveAppPort.mockResolvedValue(50000);
    makeMockCDPClient({ isLauncher: true });

    const launcher = new LauncherService(9222);
    await launcher.reconnect();

    expect(mockResolveAppPort).toHaveBeenCalledWith("launcher", 12_000);
    vi.unstubAllEnvs();
  });
});
