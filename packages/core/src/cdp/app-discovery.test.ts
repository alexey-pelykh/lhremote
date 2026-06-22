// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before any imports
// ---------------------------------------------------------------------------

vi.mock("./gather-raw-processes.js", () => ({
  gatherRawProcesses: vi.fn().mockResolvedValue([]),
}));

vi.mock("pid-port", () => ({
  pidToPorts: vi.fn().mockResolvedValue(new Set<number>()),
}));

vi.mock("../utils/cdp-port.js", () => ({
  isCdpPort: vi.fn().mockResolvedValue(false),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gatherRawProcesses } from "./gather-raw-processes.js";
import { pidToPorts } from "pid-port";
import { isCdpPort } from "../utils/cdp-port.js";
import { findApp, resolveAppPort, resolveInstancePort, resolveLauncherPort } from "./app-discovery.js";
import { LinkedHelperNotRunningError, LinkedHelperUnreachableError } from "../services/errors.js";
import type { RawProcess } from "./gather-raw-processes.js";

const mockedGatherRawProcesses = vi.mocked(gatherRawProcesses);
const mockedPidToPorts = vi.mocked(pidToPorts as (pid: number) => Promise<Set<number>>);
const mockedIsCdpPort = vi.mocked(isCdpPort);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function launcherProc(pid: number, ppid = 0): RawProcess {
  return {
    pid,
    ppid,
    name: "linked-helper.exe",
    cmdline: `C:\\Users\\test\\AppData\\Local\\Programs\\linked-helper\\app-2.113.101\\linked-helper.exe --remote-debugging-port=9222`,
  };
}

function instanceProc(pid: number, ppid: number, appId: number, name = "Test User", email = "test@example.com"): RawProcess {
  return {
    pid,
    ppid,
    name: "linked-helper.exe",
    cmdline:
      `C:\\Users\\test\\AppData\\Local\\Programs\\linked-helper\\app-2.113.101\\resources\\out\\linked-helper.exe` +
      ` --app-id=${String(appId)}` +
      ` --user-li-id=${String(appId)}` +
      ` --user-li={"id":${String(appId)},"fullName":"${name}","email":"${email}"}` +
      ` --lh-account={"email":"license-owner@example.com","fullName":"License Owner"}` +
      ` --app-credentials=REDACTED_SECRET` +
      ` --upstream-proxy=socks5://user:password@proxy.example.com` +
      ` --sentry=https://key@sentry.io/123`,
  };
}

function helperProc(pid: number, ppid: number, type: string): RawProcess {
  return {
    pid,
    ppid,
    name: "linked-helper.exe",
    cmdline: `C:\\Users\\test\\AppData\\Local\\Programs\\linked-helper\\app-2.113.101\\linked-helper.exe --type=${type}`,
  };
}

// ---------------------------------------------------------------------------
// Basic process discovery
// ---------------------------------------------------------------------------

describe("findApp basic discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when no LinkedHelper processes are running", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      { pid: 100, ppid: 1, name: "chrome", cmdline: "chrome" },
      { pid: 200, ppid: 1, name: "node", cmdline: "node" },
    ]);

    expect(await findApp()).toEqual([]);
  });

  it("returns empty array when gatherRawProcesses throws", async () => {
    mockedGatherRawProcesses.mockRejectedValue(new Error("permission denied"));
    expect(await findApp()).toEqual([]);
  });

  it("discovers a linked-helper process with CDP port", async () => {
    mockedGatherRawProcesses.mockResolvedValue([launcherProc(1000)]);
    mockedPidToPorts.mockResolvedValue(new Set([9222]));
    mockedIsCdpPort.mockResolvedValue(true);

    const result = await findApp();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pid: 1000, cdpPort: 9222, connectable: true, role: "launcher" });
  });

  it("discovers linked-helper.exe (case-insensitive name matching)", async () => {
    mockedGatherRawProcesses.mockResolvedValue([{ ...launcherProc(2000), name: "LinkedHelper.exe" }]);
    mockedPidToPorts.mockResolvedValue(new Set([9334]));
    mockedIsCdpPort.mockResolvedValue(true);

    const result = await findApp();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pid: 2000, cdpPort: 9334, connectable: true, role: "launcher" });
  });

  it("does not match processes with similar but different names", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      { pid: 100, ppid: 1, name: "linked-helper-updater", cmdline: null },
      { pid: 200, ppid: 1, name: "my-linked-helper", cmdline: null },
    ]);
    expect(await findApp()).toEqual([]);
  });

  it("sets cdpPort to null when process has no listening ports", async () => {
    mockedGatherRawProcesses.mockResolvedValue([launcherProc(1000)]);
    mockedPidToPorts.mockResolvedValue(new Set());

    const result = await findApp();
    expect(result[0]).toMatchObject({ pid: 1000, cdpPort: null, connectable: false });
  });

  it("sets cdpPort to null when pidToPorts throws", async () => {
    mockedGatherRawProcesses.mockResolvedValue([launcherProc(1000)]);
    mockedPidToPorts.mockRejectedValue(new Error("failed"));

    const result = await findApp();
    expect(result[0]).toMatchObject({ pid: 1000, cdpPort: null, connectable: false });
  });

  it("marks process non-connectable when CDP probe fails", async () => {
    mockedGatherRawProcesses.mockResolvedValue([launcherProc(1000)]);
    mockedPidToPorts.mockResolvedValue(new Set([9222]));
    mockedIsCdpPort.mockResolvedValue(false);

    const result = await findApp();
    expect(result[0]).toMatchObject({ pid: 1000, cdpPort: 9222, connectable: false });
  });

  it("finds CDP port among multiple listening ports", async () => {
    mockedGatherRawProcesses.mockResolvedValue([launcherProc(1000)]);
    mockedPidToPorts.mockResolvedValue(new Set([8080, 9222]));
    mockedIsCdpPort.mockImplementation(async (port) => port === 9222);

    const result = await findApp();
    expect(result[0]).toMatchObject({ pid: 1000, cdpPort: 9222, connectable: true });
  });
});

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------

describe("findApp role classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies resources/out/ path as instance", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      launcherProc(1000),
      instanceProc(2000, 1000, 347559),
    ]);

    const result = await findApp();
    expect(result.find((a) => a.pid === 1000)?.role).toBe("launcher");
    expect(result.find((a) => a.pid === 2000)?.role).toBe("instance");
  });

  it("classifies --type= processes as helper-child (excluded from default output)", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      launcherProc(1000),
      instanceProc(2000, 1000, 347559),
      helperProc(3001, 2000, "gpu-process"),
      helperProc(3002, 2000, "renderer"),
      helperProc(3003, 2000, "utility"),
      helperProc(3004, 1000, "crashpad-handler"),
    ]);

    const result = await findApp();
    expect(result).toHaveLength(2);  // launcher + instance only
    expect(result.every((a) => a.role !== "helper-child")).toBe(true);
  });

  it("includes helper children when includeHelpers is true", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      launcherProc(1000),
      instanceProc(2000, 1000, 347559),
      helperProc(3001, 2000, "gpu-process"),
      helperProc(3002, 2000, "renderer"),
    ]);

    const result = await findApp({ includeHelpers: true });
    const helpers = result.filter((a) => a.role === "helper-child");
    expect(helpers).toHaveLength(2);
    expect(helpers.every((h) => h.parentPid === 2000)).toBe(true);
  });

  it("falls back to parent-PID heuristic when cmdline is null", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      { pid: 1000, ppid: 999, name: "linked-helper.exe", cmdline: null },  // ppid not in LH set → launcher
      { pid: 2000, ppid: 1000, name: "linked-helper.exe", cmdline: null }, // ppid in LH set → instance
    ]);

    const result = await findApp();
    expect(result.find((a) => a.pid === 1000)?.role).toBe("launcher");
    expect(result.find((a) => a.pid === 2000)?.role).toBe("instance");
  });
});

// ---------------------------------------------------------------------------
// helperChildCount
// ---------------------------------------------------------------------------

describe("findApp helperChildCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("attributes helper children per owning process", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      launcherProc(15576),
      instanceProc(13004, 15576, 347559),
      helperProc(8001, 13004, "gpu-process"),
      helperProc(8002, 13004, "renderer"),
      helperProc(8003, 13004, "utility"),
      helperProc(8004, 15576, "crashpad-handler"),
    ]);

    const result = await findApp();
    expect(result.find((a) => a.pid === 13004)?.helperChildCount).toBe(3);
    expect(result.find((a) => a.pid === 15576)?.helperChildCount).toBe(1);
  });

  it("reports helperChildCount 0 for processes with no helper children", async () => {
    mockedGatherRawProcesses.mockResolvedValue([launcherProc(1000)]);

    const result = await findApp();
    expect(result[0]?.helperChildCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3-running-not-7 regression
// ---------------------------------------------------------------------------

describe("findApp: 3 running instances (not 7 configured accounts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("returns exactly 3 instance rows when only 3 processes are running", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      launcherProc(15576),
      instanceProc(13004, 15576, 347559, "Vira Lyn", "viraInsoftex@gmail.com"),
      instanceProc(13640, 15576, 329925, "Mike Florko", "mike@insoftex.com"),
      instanceProc(7044,  15576, 331874, "Michael Fliorko", "mfliorko@insoftex.com"),
      helperProc(8001, 13004, "gpu-process"),
      helperProc(8002, 13640, "gpu-process"),
      helperProc(8003, 7044,  "gpu-process"),
    ]);

    const result = await findApp();
    const instances = result.filter((a) => a.role === "instance");
    expect(instances).toHaveLength(3);

    const accountIds = instances.map((a) => a.identity?.accountId).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(accountIds).toEqual([329925, 331874, 347559]);
  });
});

// ---------------------------------------------------------------------------
// CDP port wiring
// ---------------------------------------------------------------------------

describe("findApp CDP port wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wires real CDP ports to the 3 running instances", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      instanceProc(13004, 0, 347559),
      instanceProc(13640, 0, 329925),
      instanceProc(7044,  0, 331874),
    ]);
    mockedPidToPorts.mockImplementation(async (pid: number) => {
      if (pid === 13004) return new Set([50297]);
      if (pid === 13640) return new Set([56429]);
      if (pid === 7044)  return new Set([49530]);
      return new Set();
    });
    mockedIsCdpPort.mockImplementation(async (port: number) => [50297, 56429, 49530].includes(port));

    const result = await findApp();
    expect(result.find((a) => a.pid === 13004)).toMatchObject({ cdpPort: 50297, connectable: true });
    expect(result.find((a) => a.pid === 13640)).toMatchObject({ cdpPort: 56429, connectable: true });
    expect(result.find((a) => a.pid === 7044 )).toMatchObject({ cdpPort: 49530, connectable: true });
  });
});

// ---------------------------------------------------------------------------
// Identity parsing and --lh-account decoy
// ---------------------------------------------------------------------------

describe("findApp identity parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("populates identity.accountId from --app-id in cmdline", async () => {
    mockedGatherRawProcesses.mockResolvedValue([instanceProc(2000, 0, 347559)]);

    const result = await findApp();
    expect(result[0]?.identity?.accountId).toBe(347559);
    expect(result[0]?.identity?.confidence).toBe("high");
    expect(result[0]?.identity?.source).toBe("cmdline");
  });

  it("sets identity.confidence=unknown for instance without --app-id", async () => {
    mockedGatherRawProcesses.mockResolvedValue([{
      pid: 2000,
      ppid: 0,
      name: "linked-helper.exe",
      cmdline: "C:\\path\\resources\\out\\linked-helper.exe --env=PROD",
    }]);

    const result = await findApp();
    expect(result[0]?.role).toBe("instance");
    expect(result[0]?.identity?.accountId).toBeNull();
    expect(result[0]?.identity?.confidence).toBe("unknown");
  });

  it("does not add identity to launcher processes", async () => {
    mockedGatherRawProcesses.mockResolvedValue([launcherProc(1000)]);
    mockedPidToPorts.mockResolvedValue(new Set([9222]));
    mockedIsCdpPort.mockResolvedValue(true);

    const result = await findApp();
    expect(result[0]?.role).toBe("launcher");
    expect(result[0]).not.toHaveProperty("identity");
  });

  it("three instances with identical --lh-account (license owner decoy) resolve to 3 distinct accounts", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      instanceProc(13004, 0, 347559, "Vira Lyn", "vira@example.com"),
      instanceProc(13640, 0, 329925, "Mike Florko", "mike@example.com"),
      instanceProc(7044,  0, 331874, "Michael Fliorko", "michael@example.com"),
    ]);

    const result = await findApp();
    const accountIds = new Set(result.map((a) => a.identity?.accountId));
    expect(accountIds.size).toBe(3);
    expect(accountIds.has(347559)).toBe(true);
    expect(accountIds.has(329925)).toBe(true);
    expect(accountIds.has(331874)).toBe(true);

    // None should have "License Owner" as name (from the --lh-account decoy)
    const names = result.map((a) => a.identity?.name);
    expect(names).not.toContain("License Owner");
  });
});

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

describe("findApp secret redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("never exposes credentials, proxy info, or Sentry DSN in output", async () => {
    mockedGatherRawProcesses.mockResolvedValue([instanceProc(13004, 0, 347559)]);

    const result = await findApp();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("REDACTED_SECRET");
    expect(serialized).not.toContain("socks5://");
    expect(serialized).not.toContain("upstream-proxy");
    expect(serialized).not.toContain("sentry.io");
    expect(serialized).not.toContain("--sentry");
  });
});

// ---------------------------------------------------------------------------
// Connectable-first ordering
// ---------------------------------------------------------------------------

describe("findApp result ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("places connectable entries before non-connectable ones", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      instanceProc(100, 0, 111),  // non-connectable
      instanceProc(200, 0, 222),  // connectable
    ]);
    mockedPidToPorts.mockImplementation(async (pid: number) => {
      if (pid === 200) return new Set([54321]);
      return new Set();
    });
    mockedIsCdpPort.mockImplementation(async (port: number) => port === 54321);

    const result = await findApp();
    expect(result[0]?.pid).toBe(200);
    expect(result[0]?.connectable).toBe(true);
    expect(result[1]?.pid).toBe(100);
    expect(result[1]?.connectable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveAppPort
// ---------------------------------------------------------------------------

describe("resolveAppPort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns launcher port when launcher role requested", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      launcherProc(1000),
      instanceProc(2000, 1000, 347559),
    ]);
    mockedPidToPorts.mockImplementation(async (pid: number) => {
      if (pid === 1000) return new Set([9222]);
      if (pid === 2000) return new Set([55660]);
      return new Set();
    });
    mockedIsCdpPort.mockResolvedValue(true);

    expect(await resolveAppPort("launcher")).toBe(9222);
  });

  it("returns instance port when instance role requested", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      launcherProc(1000),
      instanceProc(2000, 1000, 347559),
    ]);
    mockedPidToPorts.mockImplementation(async (pid: number) => {
      if (pid === 1000) return new Set([9222]);
      if (pid === 2000) return new Set([55660]);
      return new Set();
    });
    mockedIsCdpPort.mockResolvedValue(true);

    expect(await resolveAppPort("instance")).toBe(55660);
  });

  it("throws LinkedHelperNotRunningError when no LH processes found", async () => {
    mockedGatherRawProcesses.mockResolvedValue([]);
    await expect(resolveAppPort("launcher")).rejects.toThrow(LinkedHelperNotRunningError);
  });

  it("throws LinkedHelperUnreachableError when no matching role is connectable (retryTimeout=0)", async () => {
    mockedGatherRawProcesses.mockResolvedValue([launcherProc(1000)]);
    mockedPidToPorts.mockResolvedValue(new Set([9222]));
    mockedIsCdpPort.mockResolvedValue(true);

    await expect(resolveAppPort("instance", 0)).rejects.toThrow(LinkedHelperUnreachableError);
  });
});

// ---------------------------------------------------------------------------
// resolveInstancePort
// ---------------------------------------------------------------------------

describe("resolveInstancePort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("returns explicit port verbatim", async () => {
    expect(await resolveInstancePort(12345)).toBe(12345);
  });

  it("returns explicit port even with non-loopback host", async () => {
    expect(await resolveInstancePort(12345, "192.168.1.100")).toBe(12345);
  });

  it("throws when non-loopback host and no port", async () => {
    await expect(resolveInstancePort(undefined, "192.168.1.100")).rejects.toThrow(
      "cdpPort is required when using a non-loopback cdpHost",
    );
  });

  it("auto-discovers when no host specified", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      launcherProc(1000),
      instanceProc(2000, 1000, 347559),
    ]);
    mockedPidToPorts.mockImplementation(async (pid: number) => {
      if (pid === 1000) return new Set([9222]);
      if (pid === 2000) return new Set([55660]);
      return new Set();
    });
    mockedIsCdpPort.mockResolvedValue(true);

    expect(await resolveInstancePort()).toBe(55660);
  });

  it("auto-discovers when host is loopback", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      launcherProc(1000),
      instanceProc(2000, 1000, 347559),
    ]);
    mockedPidToPorts.mockImplementation(async (pid: number) => {
      if (pid === 1000) return new Set([9222]);
      if (pid === 2000) return new Set([55660]);
      return new Set();
    });
    mockedIsCdpPort.mockResolvedValue(true);

    expect(await resolveInstancePort(undefined, "127.0.0.1")).toBe(55660);
  });
});

// ---------------------------------------------------------------------------
// resolveLauncherPort
// ---------------------------------------------------------------------------

describe("resolveLauncherPort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("returns explicit port verbatim", async () => {
    expect(await resolveLauncherPort(9222)).toBe(9222);
  });

  it("throws when non-loopback host and no port", async () => {
    await expect(resolveLauncherPort(undefined, "10.0.0.5")).rejects.toThrow(
      "cdpPort is required when using a non-loopback cdpHost",
    );
  });

  it("auto-discovers when no host specified", async () => {
    mockedGatherRawProcesses.mockResolvedValue([launcherProc(1000)]);
    mockedPidToPorts.mockResolvedValue(new Set([9222]));
    mockedIsCdpPort.mockResolvedValue(true);

    expect(await resolveLauncherPort()).toBe(9222);
  });
});
