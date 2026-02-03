import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cdp/index.js")>();
  return {
    ...actual,
    discoverInstancePort: vi.fn(),
  };
});

import { discoverInstancePort } from "../cdp/index.js";
import { StartInstanceError } from "./errors.js";
import type { LauncherService } from "./launcher.js";
import {
  startInstanceWithRecovery,
  waitForInstancePort,
} from "./instance-lifecycle.js";

function createMockLauncher(
  overrides: Partial<Record<keyof LauncherService, unknown>> = {},
): LauncherService {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    startInstance: vi.fn().mockResolvedValue(undefined),
    stopInstance: vi.fn().mockResolvedValue(undefined),
    listAccounts: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LauncherService;
}

describe("startInstanceWithRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns started with port on successful start", async () => {
    const launcher = createMockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

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

    const result = await startInstanceWithRecovery(launcher, 42, 9222);

    expect(result).toEqual({ status: "already_running", port: 55123 });
    expect(launcher.stopInstance).not.toHaveBeenCalled();
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

    const result = await startInstanceWithRecovery(launcher, 42, 9222);

    expect(launcher.stopInstance).toHaveBeenCalledWith(42);
    expect(startInstance).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: "started", port: 55999 });
  });

  it("returns timeout when port never becomes available", async () => {
    const launcher = createMockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    const resultPromise = startInstanceWithRecovery(launcher, 42, 9222);
    await vi.advanceTimersByTimeAsync(16_000);
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

    const result = await waitForInstancePort(9222);

    expect(result).toBe(55123);
    expect(discoverInstancePort).toHaveBeenCalledTimes(3);
  });

  it("returns null on timeout", async () => {
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    const resultPromise = waitForInstancePort(9222);
    await vi.advanceTimersByTimeAsync(16_000);
    const result = await resultPromise;

    expect(result).toBeNull();
  });
});
