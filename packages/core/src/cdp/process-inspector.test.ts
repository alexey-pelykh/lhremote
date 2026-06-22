// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before any imports from the module
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
import { parseIdentityFromCmdline, reapOrphans, scanOrphans, scanRunningInstances } from "./process-inspector.js";
import type { OrphanProcess } from "./process-inspector.js";
import type { RawProcess } from "./gather-raw-processes.js";

const mockedGatherRawProcesses = vi.mocked(gatherRawProcesses);
const mockedPidToPorts = vi.mocked(pidToPorts as (pid: number) => Promise<Set<number>>);
const mockedIsCdpPort = vi.mocked(isCdpPort);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a typical account-instance main process command line. */
function instanceCmdline(opts: {
  appId?: number;
  userLiId?: number;
  fullName?: string;
  email?: string;
  lhAccountEmail?: string; // The decoy --lh-account field
}): string {
  const id = opts.appId ?? 347559;
  const userLi = JSON.stringify({
    id,
    fullName: opts.fullName ?? "Test User",
    email: opts.email ?? "test@example.com",
    avatar: "https://example.com/avatar.jpg",
  });
  // Decoy --lh-account (license owner, same for all instances)
  const lhAccount = JSON.stringify({
    email: opts.lhAccountEmail ?? "license-owner@example.com",
    fullName: "License Owner",
  });
  return (
    `C:\\Users\\test\\AppData\\Local\\Programs\\linked-helper\\app-2.113.101\\resources\\out\\linked-helper.exe` +
    ` --args --env=PROD` +
    ` --app-id=${String(id)}` +
    ` --user-li-id=${String(opts.userLiId ?? id)}` +
    ` --user-li=${userLi}` +
    ` --lh-account=${lhAccount}` +
    ` --app-credentials=REDACTED_SECRET` +
    ` --upstream-proxy=socks5://user:password@proxy.example.com` +
    ` --sentry=https://key@sentry.io/123`
  );
}

/**
 * Build a Windows-realistic instance command line that mirrors the WMI
 * CommandLine field: arguments containing special characters are wrapped in
 * outer double-quotes, and the JSON payload uses backslash-escaped quotes.
 *
 * Example: `"--user-li={\"id\":347559,\"fullName\":\"Vira Lyn\",...}"`
 *
 * This is the format that exposed the findFlagStart bug (charBefore = `"`,
 * not whitespace) when running on a real Windows machine.
 */
function instanceCmdlineWindows(opts: {
  appId?: number;
  fullName?: string;
  email?: string;
  lhAccountEmail?: string;
}): string {
  const id = opts.appId ?? 347559;
  const fn = opts.fullName ?? "Test User";
  const em = opts.email ?? "test@example.com";
  const lhEmail = opts.lhAccountEmail ?? "license-owner@example.com";
  // In the actual runtime string, \\" produces the two characters \" (backslash + doublequote)
  // which is how Windows WMI stores JSON inside a quoted argument.
  return (
    `C:\\Users\\test\\AppData\\Local\\linked-helper\\resources\\out\\linked-helper.exe` +
    ` --args --env=PROD` +
    ` "--app-credentials={\\"email\\":\\"${em}\\",\\"encryptedPassword\\":\\"secret\\"}"` +
    ` --app-id=${String(id)}` +
    ` --user-li-id=${String(id)}` +
    ` "--user-li={\\"id\\":${String(id)},\\"fullName\\":\\"${fn}\\",\\"email\\":\\"${em}\\",\\"platform\\":null}"` +
    ` "--lh-account={\\"email\\":\\"${lhEmail}\\",\\"fullName\\":\\"License Owner\\"}"`
  );
}

/** Build a Chromium helper child process command line. */
function helperCmdline(type: string): string {
  return (
    `C:\\Users\\test\\AppData\\Local\\Programs\\linked-helper\\app-2.113.101\\linked-helper.exe` +
    ` --type=${type} --renderer-client-id=2`
  );
}

/** Build a launcher command line. */
function launcherCmdline(): string {
  return (
    `C:\\Users\\test\\AppData\\Local\\Programs\\linked-helper\\app-2.113.101\\linked-helper.exe` +
    ` --remote-debugging-port=9222`
  );
}

function proc(pid: number, ppid: number, name: string, cmdline: string | null): RawProcess {
  return { pid, ppid, name, cmdline };
}

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------

describe("role classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies instance main process correctly", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 9000, "linked-helper.exe", instanceCmdline({})),
    ]);

    const instances = await scanRunningInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0]?.pid).toBe(13004);
  });

  it("does NOT include helper children in runningInstances", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(1000,  0,     "linked-helper.exe", launcherCmdline()),
      proc(13004, 1000,  "linked-helper.exe", instanceCmdline({})),
      proc(8008,  13004, "linked-helper.exe", helperCmdline("utility")),
      proc(8009,  13004, "linked-helper.exe", helperCmdline("gpu-process")),
      proc(8010,  1000,  "linked-helper.exe", helperCmdline("crashpad-handler")),
    ]);

    const instances = await scanRunningInstances();
    // Only the instance main process (pid 13004) should appear
    expect(instances).toHaveLength(1);
    expect(instances[0]?.pid).toBe(13004);
    expect(instances.every((i) => i.pid !== 8008 && i.pid !== 8009 && i.pid !== 8010)).toBe(true);
  });

  it("counts helper children per instance", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0,     "linked-helper.exe", instanceCmdline({ appId: 347559 })),
      proc(8008,  13004, "linked-helper.exe", helperCmdline("utility")),
      proc(8009,  13004, "linked-helper.exe", helperCmdline("gpu-process")),
      proc(8010,  13004, "linked-helper.exe", helperCmdline("renderer")),
    ]);

    const instances = await scanRunningInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0]?.helperChildCount).toBe(3);
  });

  it("handles multiple instances without interference", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdline({ appId: 347559 })),
      proc(13640, 0, "linked-helper.exe", instanceCmdline({ appId: 329925, fullName: "Mike Florko", email: "mike@example.com" })),
      proc(7044,  0, "linked-helper.exe", instanceCmdline({ appId: 331874, fullName: "Michael Fliorko", email: "michael@example.com" })),
    ]);

    const instances = await scanRunningInstances();
    expect(instances).toHaveLength(3);
    const ids = instances.map((i) => i.accountId).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(ids).toEqual([329925, 331874, 347559]);
  });
});

// ---------------------------------------------------------------------------
// Identity parsing
// ---------------------------------------------------------------------------

describe("identity parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("extracts accountId from --app-id", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdline({ appId: 347559 })),
    ]);

    const [inst] = await scanRunningInstances();
    expect(inst?.accountId).toBe(347559);
    expect(inst?.confidence).toBe("high");
    expect(inst?.source).toBe("cmdline");
  });

  it("extracts name and email from --user-li JSON", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdline({ appId: 347559, fullName: "Vira Lyn", email: "vira@example.com" })),
    ]);

    const [inst] = await scanRunningInstances();
    expect(inst?.name).toBe("Vira Lyn");
    expect(inst?.email).toBe("vira@example.com");
  });

  it("three instances with identical --lh-account resolve to three DISTINCT accounts (decoy regression)", async () => {
    const sharedLhAccountEmail = "license-owner@example.com";
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdline({ appId: 347559, fullName: "Vira Lyn", email: "vira@example.com", lhAccountEmail: sharedLhAccountEmail })),
      proc(13640, 0, "linked-helper.exe", instanceCmdline({ appId: 329925, fullName: "Mike Florko", email: "mike@example.com", lhAccountEmail: sharedLhAccountEmail })),
      proc(7044,  0, "linked-helper.exe", instanceCmdline({ appId: 331874, fullName: "Michael Fliorko", email: "michael@example.com", lhAccountEmail: sharedLhAccountEmail })),
    ]);

    const instances = await scanRunningInstances();
    expect(instances).toHaveLength(3);

    const accountIds = new Set(instances.map((i) => i.accountId));
    expect(accountIds.size).toBe(3);
    expect(accountIds.has(347559)).toBe(true);
    expect(accountIds.has(329925)).toBe(true);
    expect(accountIds.has(331874)).toBe(true);

    // Verify names are distinct (not all "License Owner" from --lh-account)
    const names = instances.map((i) => i.name);
    expect(names).not.toContain("License Owner");
    expect(names).toContain("Vira Lyn");
    expect(names).toContain("Mike Florko");
    expect(names).toContain("Michael Fliorko");
  });

  it("sets confidence=unknown when no identity fields are present", async () => {
    const bareCmd = "C:\\path\\resources\\out\\linked-helper.exe --env=PROD";
    mockedGatherRawProcesses.mockResolvedValue([
      proc(99, 0, "linked-helper.exe", bareCmd),
    ]);

    const instances = await scanRunningInstances();
    expect(instances[0]?.accountId).toBeNull();
    expect(instances[0]?.confidence).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Secret redaction: tool output must never contain secrets
// ---------------------------------------------------------------------------

describe("secret redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("never exposes --app-credentials in output", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdline({ appId: 347559 })),
    ]);

    const instances = await scanRunningInstances();
    const serialized = JSON.stringify(instances);
    expect(serialized).not.toContain("REDACTED_SECRET");
    expect(serialized).not.toContain("app-credentials");
  });

  it("never exposes --upstream-proxy credentials in output", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdline({ appId: 347559 })),
    ]);

    const instances = await scanRunningInstances();
    const serialized = JSON.stringify(instances);
    expect(serialized).not.toContain("socks5://");
    expect(serialized).not.toContain("upstream-proxy");
  });

  it("never exposes Sentry DSN in output", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdline({ appId: 347559 })),
    ]);

    const instances = await scanRunningInstances();
    const serialized = JSON.stringify(instances);
    expect(serialized).not.toContain("sentry.io");
    expect(serialized).not.toContain("--sentry");
  });

  it("never exposes raw --lh-account license data in output", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdline({ appId: 347559, lhAccountEmail: "license-owner@secret.com" })),
    ]);

    const instances = await scanRunningInstances();
    const serialized = JSON.stringify(instances);
    expect(serialized).not.toContain("license-owner@secret.com");
  });
});

// ---------------------------------------------------------------------------
// Orphan detection
// ---------------------------------------------------------------------------

describe("scanOrphans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("returns zero orphans when every non-connectable is a --type= child of a live parent", async () => {
    mockedPidToPorts.mockImplementation(async (pid: number) => {
      if (pid === 13004) return new Set([54321]);
      return new Set();
    });
    mockedIsCdpPort.mockImplementation(async (port: number) => port === 54321);

    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0,     "linked-helper.exe", instanceCmdline({ appId: 347559 })),
      proc(8008,  13004, "linked-helper.exe", helperCmdline("utility")),
      proc(8009,  13004, "linked-helper.exe", helperCmdline("gpu-process")),
    ]);

    const liveInstances = await scanRunningInstances();
    const orphans = await scanOrphans(liveInstances);
    expect(orphans).toHaveLength(0);
  });

  it("detects non-connectable instance-side process as orphan", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(9999, 0, "linked-helper.exe", instanceCmdline({ appId: 347559 })),
    ]);

    const liveInstances: never[] = [];
    const orphans = await scanOrphans(liveInstances);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.pid).toBe(9999);
    expect(orphans[0]?.accountId).toBe(347559);
  });

  it("does not report live connectable instances as orphans", async () => {
    mockedPidToPorts.mockImplementation(async (pid: number) => {
      if (pid === 13004) return new Set([54321]);
      return new Set();
    });
    mockedIsCdpPort.mockImplementation(async (port: number) => port === 54321);

    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdline({ appId: 347559 })),
    ]);

    const liveInstances = await scanRunningInstances();
    const orphans = await scanOrphans(liveInstances);
    expect(orphans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// reapOrphans
// ---------------------------------------------------------------------------

describe("reapOrphans", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeOrphan(pid: number, accountId: number | null = null): OrphanProcess {
    return { pid, cdpPort: null, accountId, reason: "non-connectable account-instance process" };
  }

  it("dry-run: returns action=dry-run for all orphans without killing", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const orphans = [makeOrphan(1001, 347559), makeOrphan(1002, 329925)];

    const results = await reapOrphans(orphans, false);

    expect(killSpy).not.toHaveBeenCalled();
    expect(results).toEqual([
      { pid: 1001, action: "dry-run" },
      { pid: 1002, action: "dry-run" },
    ]);
  });

  it("confirm: sends SIGKILL to each orphan and returns action=killed", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const orphans = [makeOrphan(2001, 111), makeOrphan(2002, 222)];

    const results = await reapOrphans(orphans, true);

    expect(killSpy).toHaveBeenCalledTimes(2);
    expect(killSpy).toHaveBeenCalledWith(2001, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(2002, "SIGKILL");
    expect(results).toEqual([
      { pid: 2001, action: "killed" },
      { pid: 2002, action: "killed" },
    ]);
  });

  it("confirm: returns action=skipped with error reason when kill throws", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });
    const orphans = [makeOrphan(3001, 333)];

    const results = await reapOrphans(orphans, true);

    expect(results).toEqual([
      { pid: 3001, action: "skipped", reason: "ESRCH: no such process" },
    ]);
  });

  it("returns empty array when given empty input (dry-run and confirm)", async () => {
    expect(await reapOrphans([], false)).toEqual([]);
    expect(await reapOrphans([], true)).toEqual([]);
  });

  it("confirm: processes that no longer exist at kill time are reported as skipped", async () => {
    const killSpy = vi.spyOn(process, "kill")
      .mockImplementationOnce(() => true)
      .mockImplementationOnce(() => { throw new Error("ESRCH"); });
    const orphans = [makeOrphan(4001, 444), makeOrphan(4002, 555)];

    const results = await reapOrphans(orphans, true);

    expect(results[0]).toEqual({ pid: 4001, action: "killed" });
    expect(results[1]).toEqual({ pid: 4002, action: "skipped", reason: "ESRCH" });
    expect(killSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Windows-quoted cmdline (real runtime format — regression for findFlagStart bug)
// ---------------------------------------------------------------------------

describe("Windows-quoted cmdline parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPidToPorts.mockResolvedValue(new Set());
    mockedIsCdpPort.mockResolvedValue(false);
  });

  it("parses accountId, name, and email from a Windows-quoted --user-li arg", () => {
    const cmdline = instanceCmdlineWindows({ appId: 347559, fullName: "Vira Lyn", email: "vira@example.com" });
    const identity = parseIdentityFromCmdline(cmdline);
    expect(identity.accountId).toBe(347559);
    expect(identity.name).toBe("Vira Lyn");
    expect(identity.email).toBe("vira@example.com");
    expect(identity.confidence).toBe("high");
  });

  it("does NOT use the --lh-account owner name for identity (decoy guard)", () => {
    const cmdline = instanceCmdlineWindows({
      appId: 347559,
      fullName: "Vira Lyn",
      lhAccountEmail: "owner@example.com",
    });
    const identity = parseIdentityFromCmdline(cmdline);
    expect(identity.name).toBe("Vira Lyn");
    expect(identity.name).not.toBe("License Owner");
  });

  it("three Windows-quoted instances each resolve their own distinct identity", async () => {
    mockedGatherRawProcesses.mockResolvedValue([
      proc(13004, 0, "linked-helper.exe", instanceCmdlineWindows({ appId: 347559, fullName: "Vira Lyn",       email: "vira@example.com" })),
      proc(13640, 0, "linked-helper.exe", instanceCmdlineWindows({ appId: 329925, fullName: "Mike Florko",    email: "mike@example.com" })),
      proc(7044,  0, "linked-helper.exe", instanceCmdlineWindows({ appId: 331874, fullName: "Michael Fliorko", email: "michael@example.com" })),
    ]);

    const instances = await scanRunningInstances();
    expect(instances).toHaveLength(3);

    const byId = Object.fromEntries(instances.map((i) => [String(i.accountId), i]));
    expect(byId["347559"]?.name).toBe("Vira Lyn");
    expect(byId["329925"]?.name).toBe("Mike Florko");
    expect(byId["331874"]?.name).toBe("Michael Fliorko");
    expect(byId["347559"]?.email).toBe("vira@example.com");
    // Confirm none resolved to the shared license-owner decoy name
    expect(instances.map((i) => i.name)).not.toContain("License Owner");
  });
});

// ---------------------------------------------------------------------------
// Connectable-first ordering
// ---------------------------------------------------------------------------

describe("result ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sorts connectable instances before non-connectable", async () => {
    mockedPidToPorts.mockImplementation(async (pid: number) => {
      if (pid === 200) return new Set([54321]);
      return new Set();
    });
    mockedIsCdpPort.mockImplementation(async (port: number) => port === 54321);

    mockedGatherRawProcesses.mockResolvedValue([
      proc(100, 0, "linked-helper.exe", instanceCmdline({ appId: 111 })), // not connectable
      proc(200, 0, "linked-helper.exe", instanceCmdline({ appId: 222 })), // connectable
    ]);

    const instances = await scanRunningInstances();
    expect(instances[0]?.pid).toBe(200);
    expect(instances[0]?.connectable).toBe(true);
    expect(instances[1]?.pid).toBe(100);
    expect(instances[1]?.connectable).toBe(false);
  });
});
