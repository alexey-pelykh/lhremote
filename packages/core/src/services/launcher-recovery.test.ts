// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CDPConnectionError } from "../cdp/index.js";
import { LinkedHelperUnreachableError } from "./errors.js";
import type { LauncherService } from "./launcher.js";
import {
  DEFAULT_LAUNCHER_RECOVERY_TIMEOUT_MS,
  withLauncherRecovery,
} from "./launcher-recovery.js";

function makeLauncher(overrides: Partial<LauncherService> = {}): LauncherService {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    reconnect: vi.fn().mockResolvedValue(undefined),
    listAccounts: vi.fn().mockResolvedValue([]),
    startInstance: vi.fn().mockResolvedValue(undefined),
    stopInstance: vi.fn().mockResolvedValue(undefined),
    isConnected: true,
    ...overrides,
  } as unknown as LauncherService;
}

describe("withLauncherRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns result with launcherRecovered=false when op succeeds on first try", async () => {
    const launcher = makeLauncher();
    const op = vi.fn().mockResolvedValue("hello");

    const { result, launcherRecovered } = await withLauncherRecovery(launcher, op);

    expect(result).toBe("hello");
    expect(launcherRecovered).toBe(false);
    expect(op).toHaveBeenCalledOnce();
    expect(launcher.reconnect).not.toHaveBeenCalled();
  });

  it("recovers on CDPConnectionError: reconnects and retries op", async () => {
    const launcher = makeLauncher();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new CDPConnectionError("WebSocket closed"))
      .mockResolvedValueOnce("recovered");

    const { result, launcherRecovered } = await withLauncherRecovery(launcher, op);

    expect(result).toBe("recovered");
    expect(launcherRecovered).toBe(true);
    expect(launcher.reconnect).toHaveBeenCalledOnce();
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("recovers on LinkedHelperUnreachableError: reconnects and retries op", async () => {
    const launcher = makeLauncher();
    const unreachable = new LinkedHelperUnreachableError([
      { pid: 1234, cdpPort: 9222, connectable: false, role: "launcher" },
    ]);
    const op = vi
      .fn()
      .mockRejectedValueOnce(unreachable)
      .mockResolvedValueOnce(42);

    const { result, launcherRecovered } = await withLauncherRecovery(launcher, op);

    expect(result).toBe(42);
    expect(launcherRecovered).toBe(true);
    expect(launcher.reconnect).toHaveBeenCalledOnce();
  });

  it("propagates non-connection errors without recovery", async () => {
    const launcher = makeLauncher();
    const domainErr = new Error("Campaign not found");
    const op = vi.fn().mockRejectedValue(domainErr);

    await expect(withLauncherRecovery(launcher, op)).rejects.toThrow(
      "Campaign not found",
    );
    expect(launcher.reconnect).not.toHaveBeenCalled();
    expect(op).toHaveBeenCalledOnce();
  });

  it("passes timeoutMs to launcher.reconnect", async () => {
    const launcher = makeLauncher();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new CDPConnectionError("closed"))
      .mockResolvedValueOnce(undefined);

    await withLauncherRecovery(launcher, op, { timeoutMs: 5_000 });

    expect(launcher.reconnect).toHaveBeenCalledWith({ timeoutMs: 5_000 });
  });

  it("uses DEFAULT_LAUNCHER_RECOVERY_TIMEOUT_MS when timeoutMs is omitted", async () => {
    const launcher = makeLauncher();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new CDPConnectionError("closed"))
      .mockResolvedValueOnce(undefined);

    await withLauncherRecovery(launcher, op);

    expect(launcher.reconnect).toHaveBeenCalledWith({
      timeoutMs: DEFAULT_LAUNCHER_RECOVERY_TIMEOUT_MS,
    });
  });

  it("propagates structured LinkedHelperUnreachableError when recovery cap is exceeded", async () => {
    const unreachable = new LinkedHelperUnreachableError([
      { pid: 9999, cdpPort: 49238, connectable: false, role: "launcher" },
    ]);
    const launcher = makeLauncher({
      reconnect: vi.fn().mockRejectedValue(unreachable),
    });
    const op = vi
      .fn()
      .mockRejectedValueOnce(new CDPConnectionError("gone"));

    const err = await withLauncherRecovery(launcher, op).catch((e: unknown) => e);

    // Must be a ServiceError subclass, not a bare CDPConnectionError.
    expect(err).toBeInstanceOf(LinkedHelperUnreachableError);
    expect((err as LinkedHelperUnreachableError).name).toBe(
      "LinkedHelperUnreachableError",
    );
  });

  it("does NOT call op a second time when reconnect throws", async () => {
    const launcher = makeLauncher({
      reconnect: vi.fn().mockRejectedValue(
        new LinkedHelperUnreachableError([]),
      ),
    });
    const op = vi
      .fn()
      .mockRejectedValueOnce(new CDPConnectionError("gone"));

    await expect(withLauncherRecovery(launcher, op)).rejects.toThrow(
      LinkedHelperUnreachableError,
    );
    expect(op).toHaveBeenCalledOnce();
  });

  it("reads LHREMOTE_LAUNCHER_RECOVERY_TIMEOUT_MS env var for timeout", async () => {
    vi.stubEnv("LHREMOTE_LAUNCHER_RECOVERY_TIMEOUT_MS", "7500");
    const launcher = makeLauncher();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new CDPConnectionError("closed"))
      .mockResolvedValueOnce(undefined);

    await withLauncherRecovery(launcher, op);

    expect(launcher.reconnect).toHaveBeenCalledWith({ timeoutMs: 7_500 });
    vi.unstubAllEnvs();
  });
});
