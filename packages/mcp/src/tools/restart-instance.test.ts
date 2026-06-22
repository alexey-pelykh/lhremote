// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    restartInstance: vi.fn(),
  };
});

import {
  LauncherService,
  LinkedHelperNotRunningError,
  restartInstance,
} from "@insoftex/lhremote-core";
import type { RestartInstanceResult } from "@insoftex/lhremote-core";

import { registerRestartInstance } from "./restart-instance.js";
import { createMockServer } from "./testing/mock-server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLauncher(overrides: Record<string, unknown> = {}) {
  const disconnect = vi.fn();
  vi.mocked(LauncherService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

function makeResult(overrides: Partial<RestartInstanceResult> = {}): RestartInstanceResult {
  return {
    accountId: 42,
    restarted: true,
    oldPid: 100,
    newPid: 200,
    cdpPort: 55002,
    verified: true,
    launcherRecovered: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerRestartInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named restart-instance", () => {
    const { server } = createMockServer();
    registerRestartInstance(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "restart-instance",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns error when accountId is missing", async () => {
    const { server, getHandler } = createMockServer();
    registerRestartInstance(server);

    mockLauncher();

    const handler = getHandler("restart-instance");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "accountId is required for restart-instance" }],
    });
    expect(vi.mocked(restartInstance)).not.toHaveBeenCalled();
  });

  it("returns JSON result on success (restarted)", async () => {
    const { server, getHandler } = createMockServer();
    registerRestartInstance(server);

    mockLauncher();
    const outcome = makeResult();
    vi.mocked(restartInstance).mockResolvedValue(outcome);

    const handler = getHandler("restart-instance");
    const result = (await handler({ accountId: 42, cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    const parsed = JSON.parse(result.content[0].text) as RestartInstanceResult;
    expect(parsed.restarted).toBe(true);
    expect(parsed.accountId).toBe(42);
    expect(parsed.verified).toBe(true);
    expect(parsed.cdpPort).toBe(55002);
  });

  it("returns JSON result when already healthy (restarted:false)", async () => {
    const { server, getHandler } = createMockServer();
    registerRestartInstance(server);

    mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(makeResult({ restarted: false }));

    const handler = getHandler("restart-instance");
    const result = (await handler({ accountId: 42, cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    const parsed = JSON.parse(result.content[0].text) as RestartInstanceResult;
    expect(parsed.restarted).toBe(false);
  });

  it("passes force:true to restartInstance", async () => {
    const { server, getHandler } = createMockServer();
    registerRestartInstance(server);

    mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(makeResult());

    const handler = getHandler("restart-instance");
    await handler({ accountId: 42, cdpPort: 9222, force: true });

    expect(vi.mocked(restartInstance)).toHaveBeenCalledWith(
      expect.anything(),
      42,
      9222,
      expect.objectContaining({ force: true }),
    );
  });

  it("defaults force to false when not supplied", async () => {
    const { server, getHandler } = createMockServer();
    registerRestartInstance(server);

    mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(makeResult());

    const handler = getHandler("restart-instance");
    await handler({ accountId: 42, cdpPort: 9222 });

    expect(vi.mocked(restartInstance)).toHaveBeenCalledWith(
      expect.anything(),
      42,
      9222,
      expect.objectContaining({ force: false }),
    );
  });

  it("returns error when LinkedHelper not running", async () => {
    const { server, getHandler } = createMockServer();
    registerRestartInstance(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("restart-instance");
    const result = await handler({ accountId: 42, cdpPort: 9222 });

    expect(result).toMatchObject({ isError: true });
  });

  it("returns error when restartInstance throws", async () => {
    const { server, getHandler } = createMockServer();
    registerRestartInstance(server);

    mockLauncher();
    vi.mocked(restartInstance).mockRejectedValue(new Error("restart failed"));

    const handler = getHandler("restart-instance");
    const result = (await handler({ accountId: 42, cdpPort: 9222 })) as {
      isError: boolean;
      content: [{ text: string }];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("restart failed");
  });

  it("disconnects after success", async () => {
    const { server, getHandler } = createMockServer();
    registerRestartInstance(server);

    const { disconnect } = mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(makeResult());

    const handler = getHandler("restart-instance");
    await handler({ accountId: 42, cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects after error", async () => {
    const { server, getHandler } = createMockServer();
    registerRestartInstance(server);

    const { disconnect } = mockLauncher();
    vi.mocked(restartInstance).mockRejectedValue(new Error("boom"));

    const handler = getHandler("restart-instance");
    await handler({ accountId: 42, cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
