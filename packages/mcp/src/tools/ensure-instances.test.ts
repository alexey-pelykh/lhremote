// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    ensureInstances: vi.fn(),
    resolveLauncherPort: vi.fn(),
  };
});

import {
  type EnsureInstanceResult,
  LauncherService,
  ensureInstances,
  resolveLauncherPort,
} from "@insoftex/lhremote-core";
import { registerEnsureInstances } from "./ensure-instances.js";
import { createMockServer } from "./testing/mock-server.js";

const mockedLauncherService = vi.mocked(LauncherService);
const mockedEnsureInstances = vi.mocked(ensureInstances);
const mockedResolveLauncherPort = vi.mocked(resolveLauncherPort);

function mockLauncher(): { disconnect: ReturnType<typeof vi.fn> } {
  const disconnect = vi.fn();
  mockedLauncherService.mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

describe("registerEnsureInstances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveLauncherPort.mockResolvedValue(9222);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named ensure-instances", () => {
    const { server } = createMockServer();
    registerEnsureInstances(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "ensure-instances",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns per-account result table as JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerEnsureInstances(server);

    mockLauncher();

    const results: EnsureInstanceResult[] = [
      { accountId: 1, status: "already_running", cdpPort: 54321, pid: 13004, verified: true },
      { accountId: 2, status: "started", cdpPort: 54322, pid: 13005, verified: true },
    ];
    mockedEnsureInstances.mockResolvedValue(results);

    const handler = getHandler("ensure-instances");
    const result = (await handler({ accountIds: [1, 2], cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    expect(JSON.parse(result.content[0].text)).toEqual(results);
  });

  it("skips already-running accounts and starts the rest", async () => {
    const { server, getHandler } = createMockServer();
    registerEnsureInstances(server);

    mockLauncher();
    mockedEnsureInstances.mockResolvedValue([
      { accountId: 42, status: "already_running", cdpPort: 54321, pid: 100, verified: true },
    ]);

    const handler = getHandler("ensure-instances");
    await handler({ accountIds: [42], cdpPort: 9222 });

    expect(mockedEnsureInstances).toHaveBeenCalledWith(
      [42],
      expect.any(Object),
      9222,
    );
  });

  it("disconnects after completion", async () => {
    const { server, getHandler } = createMockServer();
    registerEnsureInstances(server);

    const { disconnect } = mockLauncher();
    mockedEnsureInstances.mockResolvedValue([]);

    const handler = getHandler("ensure-instances");
    await handler({ accountIds: [1], cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects even after error", async () => {
    const { server, getHandler } = createMockServer();
    registerEnsureInstances(server);

    const { disconnect } = mockLauncher();
    mockedEnsureInstances.mockRejectedValue(new Error("boom"));

    const handler = getHandler("ensure-instances");
    const result = await handler({ accountIds: [1], cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ isError: true });
  });
});
