// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cdp/index.js")>();
  return {
    ...actual,
    discoverInstancePort: vi.fn(),
    discoverTargets: vi.fn(),
  };
});

vi.mock("./instance.js", () => {
  const InstanceService = vi.fn();
  InstanceService.prototype.connectUiOnly = vi.fn();
  InstanceService.prototype.getInstancePopups = vi.fn();
  InstanceService.prototype.disconnect = vi.fn();
  return { InstanceService };
});

import { CDPConnectionError, discoverInstancePort, discoverTargets } from "../cdp/index.js";
import type { CdpTarget } from "../types/cdp.js";
import { StartInstanceError } from "./errors.js";
import { InstanceService } from "./instance.js";
import type { LauncherService } from "./launcher.js";
import {
  startInstanceWithRecovery,
  waitForInstancePort,
  waitForInstanceShutdown,
  waitForInstanceTargets,
} from "./instance-lifecycle.js";

const LINKEDIN_TARGET: CdpTarget = {
  type: "page",
  url: "https://www.linkedin.com/feed/",
  id: "T1",
  title: "LinkedIn",
  description: "",
  devtoolsFrontendUrl: "",
};

const UI_TARGET: CdpTarget = {
  type: "page",
  url: "file:///app/index.html",
  id: "T2",
  title: "LinkedHelper",
  description: "",
  devtoolsFrontendUrl: "",
};

const BOTH_TARGETS: CdpTarget[] = [LINKEDIN_TARGET, UI_TARGET];

function createMockLauncher(
  overrides: Partial<Record<keyof LauncherService, unknown>> = {},
): LauncherService {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    startInstance: vi.fn().mockResolvedValue(undefined),
    stopInstance: vi.fn().mockResolvedValue(undefined),
    stopInstanceWithDialogDismissal: vi.fn().mockResolvedValue(undefined),
    listAccounts: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LauncherService;
}

describe("startInstanceWithRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    vi.mocked(InstanceService.prototype.connectUiOnly).mockResolvedValue(undefined);
    vi.mocked(InstanceService.prototype.getInstancePopups).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns started with port on successful start", async () => {
    const launcher = createMockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverTargets).mockResolvedValue(BOTH_TARGETS);

    const result = await startInstanceWithRecovery(launcher, 42, 9222);

    expect(launcher.startInstance).toHaveBeenCalledWith(42);
    expect(result).toEqual({ status: "started", port: 55123 });
  });

  it("returns already_running when instance is running and port discoverable", async () => {
    const launcher = createMockLauncher({
      startInstance: vi
        .fn()
        .mockRejectedValue(
          new StartInstanceError(42, "account is already running"),
        ),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverTargets).mockResolvedValue(BOTH_TARGETS);

    const result = await startInstanceWithRecovery(launcher, 42, 9222);

    expect(result).toEqual({ status: "already_running", port: 55123 });
    expect(launcher.stopInstance).not.toHaveBeenCalled();
  });

  it("returns timeout when already running but targets never appear", async () => {
    const launcher = createMockLauncher({
      startInstance: vi
        .fn()
        .mockRejectedValue(
          new StartInstanceError(42, "account is already running"),
        ),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverTargets).mockResolvedValue([UI_TARGET]);

    const resultPromise = startInstanceWithRecovery(launcher, 42, 9222);
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await resultPromise;

    expect(result).toEqual({ status: "timeout" });
  });

  it("performs crash recovery when already running but no port", async () => {
    const startInstance = vi
      .fn()
      .mockRejectedValueOnce(
        new StartInstanceError(42, "account is already running"),
      )
      .mockResolvedValueOnce(undefined);

    const launcher = createMockLauncher({ startInstance });

    // First call (already running check): no port → crash recovery
    // After recovery + restart: port available
    vi.mocked(discoverInstancePort)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(55999);
    vi.mocked(discoverTargets).mockResolvedValue(BOTH_TARGETS);

    const result = await startInstanceWithRecovery(launcher, 42, 9222);

    expect(launcher.stopInstanceWithDialogDismissal).toHaveBeenCalledWith(42);
    expect(startInstance).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: "started", port: 55999 });
  });

  it("returns timeout when port never becomes available", async () => {
    const launcher = createMockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    const resultPromise = startInstanceWithRecovery(launcher, 42, 9222);
    await vi.advanceTimersByTimeAsync(46_000);
    const result = await resultPromise;

    expect(result).toEqual({ status: "timeout" });
  });

  it("rethrows non-already-running StartInstanceError", async () => {
    const launcher = createMockLauncher({
      startInstance: vi
        .fn()
        .mockRejectedValue(
          new StartInstanceError(42, "license expired"),
        ),
    });

    await expect(
      startInstanceWithRecovery(launcher, 42, 9222),
    ).rejects.toThrow("license expired");
  });

  it("rethrows non-StartInstanceError", async () => {
    const launcher = createMockLauncher({
      startInstance: vi
        .fn()
        .mockRejectedValue(new Error("network error")),
    });

    await expect(
      startInstanceWithRecovery(launcher, 42, 9222),
    ).rejects.toThrow("network error");
  });

  it("throws when instance starts with error popups", async () => {
    const launcher = createMockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverTargets).mockResolvedValue(BOTH_TARGETS);
    vi.mocked(InstanceService.prototype.getInstancePopups).mockResolvedValue([
      { title: "Failed to initialize UI", closable: false },
    ]);

    await expect(
      startInstanceWithRecovery(launcher, 42, 9222),
    ).rejects.toThrow("instance has error popups: Failed to initialize UI");

    expect(InstanceService.prototype.connectUiOnly).toHaveBeenCalled();
    expect(InstanceService.prototype.disconnect).toHaveBeenCalled();
  });

  it("throws when already-running instance has error popups", async () => {
    const launcher = createMockLauncher({
      startInstance: vi
        .fn()
        .mockRejectedValue(
          new StartInstanceError(42, "account is already running"),
        ),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverTargets).mockResolvedValue(BOTH_TARGETS);
    vi.mocked(InstanceService.prototype.getInstancePopups).mockResolvedValue([
      { title: "DataLayerStorage error", description: "liAccount not initialized", closable: true },
    ]);

    await expect(
      startInstanceWithRecovery(launcher, 42, 9222),
    ).rejects.toThrow(
      "instance has error popups: DataLayerStorage error — liAccount not initialized",
    );

    expect(InstanceService.prototype.disconnect).toHaveBeenCalled();
  });

  it("returns normally when popup check connection fails", async () => {
    const launcher = createMockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverTargets).mockResolvedValue(BOTH_TARGETS);
    vi.mocked(InstanceService.prototype.connectUiOnly).mockRejectedValue(
      new Error("connection refused"),
    );

    const result = await startInstanceWithRecovery(launcher, 42, 9222);

    expect(result).toEqual({ status: "started", port: 55123 });
    expect(InstanceService.prototype.disconnect).toHaveBeenCalled();
  });

  it("includes multiple popup details in error message", async () => {
    const launcher = createMockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverTargets).mockResolvedValue(BOTH_TARGETS);
    vi.mocked(InstanceService.prototype.getInstancePopups).mockResolvedValue([
      { title: "Error A", closable: false },
      { title: "Error B", description: "details", closable: true },
    ]);

    await expect(
      startInstanceWithRecovery(launcher, 42, 9222),
    ).rejects.toThrow(
      "instance has error popups: Error A; Error B — details",
    );
  });

  it("returns timeout when port is available but targets never appear", async () => {
    const launcher = createMockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverTargets).mockResolvedValue([]);

    const resultPromise = startInstanceWithRecovery(launcher, 42, 9222);
    await vi.advanceTimersByTimeAsync(76_000);
    const result = await resultPromise;

    expect(result).toEqual({ status: "timeout" });
  });

  it("throws popup error instead of timeout when popups present on target timeout", async () => {
    const launcher = createMockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverTargets).mockResolvedValue([UI_TARGET]);
    vi.mocked(InstanceService.prototype.getInstancePopups).mockResolvedValue([
      { title: "AsyncHandlerError", description: "liAccount not initialized", closable: false },
    ]);

    const resultPromise = startInstanceWithRecovery(launcher, 42, 9222);
    // Attach rejection handler before advancing timers to prevent unhandled rejection
    const assertion = expect(resultPromise).rejects.toThrow(
      "instance has error popups: AsyncHandlerError — liAccount not initialized",
    );
    await vi.advanceTimersByTimeAsync(76_000);
    await assertion;
  });
});

describe("waitForInstancePort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns port immediately when available", async () => {
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const result = await waitForInstancePort(9222);

    expect(result).toBe(55123);
  });

  it("polls until port becomes available", async () => {
    vi.mocked(discoverInstancePort)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(55123);

    const resultPromise = waitForInstancePort(9222);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await resultPromise;

    expect(result).toBe(55123);
    expect(discoverInstancePort).toHaveBeenCalledTimes(3);
  });

  it("returns null on timeout", async () => {
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    const resultPromise = waitForInstancePort(9222);
    await vi.advanceTimersByTimeAsync(46_000);
    const result = await resultPromise;

    expect(result).toBeNull();
  });
});

describe("waitForInstanceTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns true immediately when both targets are present", async () => {
    vi.mocked(discoverTargets).mockResolvedValue(BOTH_TARGETS);

    const result = await waitForInstanceTargets(55123);

    expect(result).toBe(true);
    expect(discoverTargets).toHaveBeenCalledWith(55123);
  });

  it("polls until both targets appear", async () => {
    vi.mocked(discoverTargets)
      .mockResolvedValueOnce([UI_TARGET])
      .mockResolvedValueOnce([UI_TARGET])
      .mockResolvedValue(BOTH_TARGETS);

    const resultPromise = waitForInstanceTargets(55123);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await resultPromise;

    expect(result).toBe(true);
    expect(discoverTargets).toHaveBeenCalledTimes(3);
  });

  it("returns false on timeout", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([UI_TARGET]);

    const resultPromise = waitForInstanceTargets(55123);
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await resultPromise;

    expect(result).toBe(false);
  });

  it("retries on CDP connection errors", async () => {
    vi.mocked(discoverTargets)
      .mockRejectedValueOnce(new CDPConnectionError("connection refused"))
      .mockResolvedValue(BOTH_TARGETS);

    const resultPromise = waitForInstanceTargets(55123);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toBe(true);
    expect(discoverTargets).toHaveBeenCalledTimes(2);
  });

  it("propagates non-CDP errors", async () => {
    vi.mocked(discoverTargets)
      .mockRejectedValue(new TypeError("unexpected response"));

    await expect(waitForInstanceTargets(55123)).rejects.toThrow("unexpected response");
  });
});

describe("waitForInstanceShutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves immediately when no instance port is found", async () => {
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    await waitForInstanceShutdown(9222);

    expect(discoverInstancePort).toHaveBeenCalledTimes(1);
  });

  it("polls until port disappears", async () => {
    vi.mocked(discoverInstancePort)
      .mockResolvedValueOnce(55123)
      .mockResolvedValueOnce(55123)
      .mockResolvedValue(null);

    const promise = waitForInstanceShutdown(9222);
    await vi.advanceTimersByTimeAsync(3_000);
    await promise;

    expect(discoverInstancePort).toHaveBeenCalledTimes(3);
  });

  it("resolves after timeout even if port persists", async () => {
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const promise = waitForInstanceShutdown(9222);
    await vi.advanceTimersByTimeAsync(46_000);
    await promise;

    // Should have polled multiple times then given up
    expect(vi.mocked(discoverInstancePort).mock.calls.length).toBeGreaterThan(1);
  });
});
