// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    checkStatus: vi.fn(),
  };
});

import { type StatusReport, checkStatus } from "@lhremote/core";

import { handleCheckStatus } from "./check-status.js";

const mockedCheckStatus = vi.mocked(checkStatus);

describe("handleCheckStatus", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints JSON with --json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    const report: StatusReport = {
      launcher: { reachable: true, port: 9222 },
      instances: [
        { accountId: 1, accountName: "Alice", cdpPort: 54321 },
      ],
      databases: [
        { accountId: 1, path: "/path/to/db.db", profileCount: 100 },
      ],
    };

    mockedCheckStatus.mockResolvedValue(report);

    await handleCheckStatus({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(JSON.parse(output)).toEqual(report);
  });

  it("prints human-friendly output when launcher is reachable", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: true, port: 9222 },
      instances: [
        { accountId: 1, accountName: "Alice", cdpPort: 54321 },
      ],
      databases: [
        { accountId: 1, path: "/path/to/db.db", profileCount: 42 },
      ],
    });

    await handleCheckStatus({});

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Launcher: reachable on port 9222\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Instance: Alice (1) — CDP port 54321\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Database: account 1 — 42 profiles — /path/to/db.db\n",
    );
  });

  it("prints not reachable when launcher is down", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: 9222 },
      instances: [],
      databases: [],
    });

    await handleCheckStatus({});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Launcher: not reachable on port 9222\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith("Instances: none\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Databases: none found\n");
  });

  it("prints not running when instance has no CDP port", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: true, port: 9222 },
      instances: [
        { accountId: 1, accountName: "Alice", cdpPort: null },
      ],
      databases: [],
    });

    await handleCheckStatus({});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Instance: Alice (1) — not running\n",
    );
  });

  it("sets exitCode 1 on error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockedCheckStatus.mockRejectedValue(new Error("unexpected"));

    await handleCheckStatus({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("unexpected\n");
  });

  it("passes cdpPort to checkStatus", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: 4567 },
      instances: [],
      databases: [],
    });

    await handleCheckStatus({ cdpPort: 4567 });

    expect(mockedCheckStatus).toHaveBeenCalledWith(4567, {});
  });
});
