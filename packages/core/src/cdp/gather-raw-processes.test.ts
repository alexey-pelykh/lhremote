// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before any imports from the module
// ---------------------------------------------------------------------------

vi.mock("ps-list");
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import psList from "ps-list";
import { gatherRawProcesses, invalidateProcessCache } from "./gather-raw-processes.js";

const mockedPsList = vi.mocked(psList);
const mockedExecFile = vi.mocked(execFile);

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

afterEach(() => {
  setPlatform(originalPlatform);
  vi.clearAllMocks();
  invalidateProcessCache();
});

// ---------------------------------------------------------------------------
// PowerShell stub helpers
// ---------------------------------------------------------------------------

/** Make execFile call its callback with the given stdout (success). */
function stubPowerShell(stdout: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockedExecFile as any).mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, out: { stdout: string }) => void;
    cb(null, { stdout });
  });
}

/** Make execFile call its callback with an error (failure). */
function stubPowerShellError(err: Error = new Error("PowerShell unavailable")): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockedExecFile as any).mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error) => void;
    cb(err);
  });
}

// ---------------------------------------------------------------------------
// Non-Windows path
// ---------------------------------------------------------------------------

describe("gatherRawProcesses — non-Windows (ps-list cmd field)", () => {
  beforeEach(() => {
    setPlatform("linux");
  });

  it("maps cmd field to cmdline", async () => {
    mockedPsList.mockResolvedValue([
      { pid: 100, ppid: 1, name: "node", cmd: "/usr/bin/node server.js" },
    ] as Awaited<ReturnType<typeof psList>>);

    const result = await gatherRawProcesses();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ pid: 100, ppid: 1, name: "node", cmdline: "/usr/bin/node server.js" });
  });

  it("sets cmdline to null when cmd is absent", async () => {
    mockedPsList.mockResolvedValue([
      { pid: 200, ppid: 5, name: "kernel" },
    ] as Awaited<ReturnType<typeof psList>>);

    const [proc] = await gatherRawProcesses();

    expect(proc?.cmdline).toBeNull();
  });

  it("defaults ppid to 0 when undefined", async () => {
    mockedPsList.mockResolvedValue([
      { pid: 300, name: "orphan" } as Awaited<ReturnType<typeof psList>>[number],
    ]);

    const [proc] = await gatherRawProcesses();

    expect(proc?.ppid).toBe(0);
  });

  it("returns empty array when psList fails", async () => {
    mockedPsList.mockRejectedValue(new Error("permission denied"));

    const result = await gatherRawProcesses();

    expect(result).toEqual([]);
  });

  it("does not call execFile on non-Windows platforms", async () => {
    mockedPsList.mockResolvedValue([]);

    await gatherRawProcesses();

    expect(mockedExecFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Windows path (Win32_Process via PowerShell)
// ---------------------------------------------------------------------------

describe("gatherRawProcesses — Windows (Win32_Process via PowerShell)", () => {
  beforeEach(() => {
    setPlatform("win32");
  });

  it("merges cmdline from PowerShell Win32_Process output (array)", async () => {
    mockedPsList.mockResolvedValue([
      { pid: 13004, ppid: 1, name: "linked-helper.exe" },
    ] as Awaited<ReturnType<typeof psList>>);

    stubPowerShell(
      JSON.stringify([{ ProcessId: 13004, CommandLine: "C:\\lh\\linked-helper.exe --app-id=347559" }]),
    );

    const result = await gatherRawProcesses();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      pid: 13004,
      name: "linked-helper.exe",
      cmdline: "C:\\lh\\linked-helper.exe --app-id=347559",
    });
  });

  it("handles ConvertTo-Json single-object output (not an array)", async () => {
    // PowerShell's ConvertTo-Json returns a bare object (not an array) when exactly
    // one Win32_Process row is returned. The code wraps it with [raw] to force an array.
    mockedPsList.mockResolvedValue([
      { pid: 7044, ppid: 1, name: "linked-helper.exe" },
    ] as Awaited<ReturnType<typeof psList>>);

    stubPowerShell(
      JSON.stringify({ ProcessId: 7044, CommandLine: "C:\\lh\\resources\\out\\linked-helper.exe --app-id=331874" }),
    );

    const [proc] = await gatherRawProcesses();

    expect(proc?.cmdline).toBe("C:\\lh\\resources\\out\\linked-helper.exe --app-id=331874");
  });

  it("sets cmdline to null for PIDs absent from Win32_Process output", async () => {
    mockedPsList.mockResolvedValue([
      { pid: 999, ppid: 0, name: "System" },
    ] as Awaited<ReturnType<typeof psList>>);

    stubPowerShell(JSON.stringify([]));

    const [proc] = await gatherRawProcesses();

    expect(proc?.cmdline).toBeNull();
  });

  it("sets cmdline to null when Win32_Process CommandLine field is null (system processes)", async () => {
    mockedPsList.mockResolvedValue([
      { pid: 4, ppid: 0, name: "System" },
    ] as Awaited<ReturnType<typeof psList>>);

    stubPowerShell(JSON.stringify([{ ProcessId: 4, CommandLine: null }]));

    const [proc] = await gatherRawProcesses();

    expect(proc?.cmdline).toBeNull();
  });

  it("returns procs with null cmdlines when PowerShell throws", async () => {
    mockedPsList.mockResolvedValue([
      { pid: 13004, ppid: 1, name: "linked-helper.exe" },
    ] as Awaited<ReturnType<typeof psList>>);

    stubPowerShellError();

    const result = await gatherRawProcesses();

    expect(result).toHaveLength(1);
    expect(result[0]?.cmdline).toBeNull();
  });

  it("merges cmdlines for multiple concurrent instances", async () => {
    mockedPsList.mockResolvedValue([
      { pid: 13004, ppid: 1, name: "linked-helper.exe" },
      { pid: 13640, ppid: 1, name: "linked-helper.exe" },
      { pid: 7044,  ppid: 1, name: "linked-helper.exe" },
    ] as Awaited<ReturnType<typeof psList>>);

    stubPowerShell(
      JSON.stringify([
        { ProcessId: 13004, CommandLine: "linked-helper.exe --app-id=347559" },
        { ProcessId: 13640, CommandLine: "linked-helper.exe --app-id=329925" },
        { ProcessId: 7044,  CommandLine: "linked-helper.exe --app-id=331874" },
      ]),
    );

    const result = await gatherRawProcesses();

    expect(result).toHaveLength(3);
    const byPid = Object.fromEntries(result.map((p) => [p.pid, p.cmdline]));
    expect(byPid[13004]).toContain("--app-id=347559");
    expect(byPid[13640]).toContain("--app-id=329925");
    expect(byPid[7044]).toContain("--app-id=331874");
  });
});
