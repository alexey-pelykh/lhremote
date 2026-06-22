// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    checkStatus: vi.fn(),
  };
});

import { type InstanceReadinessEntry, type StatusReport, checkStatus } from "@insoftex/lhremote-core";

import { handleCheckStatus } from "./check-status.js";

const mockedCheckStatus = vi.mocked(checkStatus);

function makeRunningInstance(overrides: Partial<InstanceReadinessEntry> = {}): InstanceReadinessEntry {
  return {
    accountId: 1,
    name: "Alice",
    email: "alice@example.com",
    pid: 12345,
    cdpPort: 54321,
    connectable: true,
    helperChildCount: 3,
    source: "cmdline",
    confidence: "high",
    readiness: "connectable",
    ...overrides,
  };
}

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
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const report: StatusReport = {
      launcher: { reachable: true, port: 9222 },
      instances: [makeRunningInstance()],
      runningInstances: [makeRunningInstance()],
      databases: [{ accountId: 1, path: "/path/to/db.db", profileCount: 100 }],
    };

    mockedCheckStatus.mockResolvedValue(report);

    await handleCheckStatus({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(JSON.parse(output)).toEqual(report);
  });

  it("prints human-friendly output when launcher is reachable", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: true, port: 9222 },
      instances: [makeRunningInstance({ accountId: 1, name: "Alice", cdpPort: 54321 })],
      runningInstances: [makeRunningInstance({ accountId: 1, name: "Alice", cdpPort: 54321 })],
      databases: [{ accountId: 1, path: "/path/to/db.db", profileCount: 42 }],
    });

    await handleCheckStatus({});

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("Launcher: reachable on port 9222\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Instance: Alice (1) — CDP port 54321\n");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Database: account 1 — 42 profiles — /path/to/db.db\n",
    );
  });

  it("prints not reachable when launcher is down", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: 9222 },
      instances: [],
      runningInstances: [],
      databases: [],
    });

    await handleCheckStatus({});

    expect(stdoutSpy).toHaveBeenCalledWith("Launcher: not reachable on port 9222\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Instances: none\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Databases: none found\n");
  });

  it("shows 3 running instances from process inspection (not 7 from launcher roster)", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const instances: InstanceReadinessEntry[] = [
      makeRunningInstance({ accountId: 347559, name: "Vira Lyn", email: "viraInsoftex@gmail.com", cdpPort: 50297, pid: 13004 }),
      makeRunningInstance({ accountId: 329925, name: "Mike Florko", email: "mike@insoftex.com", cdpPort: 56429, pid: 13640 }),
      makeRunningInstance({ accountId: 331874, name: "Michael Fliorko", email: "mfliorko@insoftex.com", cdpPort: 49530, pid: 7044 }),
    ];

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: null },
      instances,
      runningInstances: instances,
      databases: [],
    });

    await handleCheckStatus({});

    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    const instanceLines = calls.filter((l) => l.startsWith("Instance:"));
    // Only 3 running instances — never 7
    expect(instanceLines).toHaveLength(3);
    expect(instanceLines.some((l) => l.includes("Vira Lyn") && l.includes("CDP port 50297"))).toBe(true);
    expect(instanceLines.some((l) => l.includes("Mike Florko") && l.includes("CDP port 56429"))).toBe(true);
    expect(instanceLines.some((l) => l.includes("Michael Fliorko") && l.includes("CDP port 49530"))).toBe(true);
  });

  it("prints 'no CDP port' when instance has no CDP port", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: true, port: 9222 },
      instances: [makeRunningInstance({ accountId: 1, name: "Alice", cdpPort: null, connectable: false })],
      runningInstances: [makeRunningInstance({ accountId: 1, name: "Alice", cdpPort: null, connectable: false })],
      databases: [],
    });

    await handleCheckStatus({});

    expect(stdoutSpy).toHaveBeenCalledWith("Instance: Alice (1) — no CDP port\n");
  });

  it("annotates non-connectable instances with port but no response", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: null },
      instances: [makeRunningInstance({ accountId: 2, name: "Bob", cdpPort: 55000, connectable: false })],
      runningInstances: [makeRunningInstance({ accountId: 2, name: "Bob", cdpPort: 55000, connectable: false })],
      databases: [],
    });

    await handleCheckStatus({});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Instance: Bob (2) — CDP port 55000 (not responding)\n",
    );
  });

  it("sets exitCode 1 on error", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

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
      runningInstances: [],
      databases: [],
    });

    await handleCheckStatus({ cdpPort: 4567 });

    expect(mockedCheckStatus).toHaveBeenCalledWith(4567, {});
  });

  it("launcher CDP down doesn't affect process-inspection instance output", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const runningInstances: InstanceReadinessEntry[] = [
      makeRunningInstance({ accountId: 347559, name: "Vira Lyn", cdpPort: 50297, connectable: true }),
    ];

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: null },
      instances: runningInstances,
      runningInstances,
      databases: [],
      warnings: ["LinkedHelper is not running."],
    });

    await handleCheckStatus({});

    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((l) => l.includes("Vira Lyn"))).toBe(true);
    expect(calls.some((l) => l.includes("not available"))).toBe(true);
  });
});
