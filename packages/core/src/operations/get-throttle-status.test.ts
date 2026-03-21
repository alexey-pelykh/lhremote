// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withInstanceDatabase: vi.fn(),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { getThrottleStatus } from "./get-throttle-status.js";

function setupMocks(throttleResult: { throttled: boolean; since: string | null }) {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        instance: {
          evaluateUI: vi.fn().mockResolvedValue(throttleResult),
        },
        db: {},
      } as unknown as InstanceDatabaseContext),
  );
}

describe("getThrottleStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns not throttled when ThrottleDetector reports no throttling", async () => {
    setupMocks({ throttled: false, since: null });

    const result = await getThrottleStatus({ cdpPort: 9222 });

    expect(result).toEqual({ throttled: false, since: null });
  });

  it("returns throttled with timestamp when ThrottleDetector reports throttling", async () => {
    const since = "2026-03-21T10:00:00.000Z";
    setupMocks({ throttled: true, since });

    const result = await getThrottleStatus({ cdpPort: 9222 });

    expect(result).toEqual({ throttled: true, since });
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks({ throttled: false, since: null });

    await getThrottleStatus({
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      getThrottleStatus({ cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      getThrottleStatus({ cdpPort: 9222 }),
    ).rejects.toThrow("instance not running");
  });
});
