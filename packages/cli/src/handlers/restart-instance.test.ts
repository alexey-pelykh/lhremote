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
    resolveAppPort: vi.fn().mockResolvedValue(9222),
    restartInstance: vi.fn(),
  };
});

import {
  LauncherService,
  resolveAppPort,
  restartInstance,
} from "@insoftex/lhremote-core";
import type { RestartInstanceResult } from "@insoftex/lhremote-core";

import { handleRestartInstance } from "./restart-instance.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLauncher(overrides: Record<string, unknown> = {}) {
  vi.mocked(LauncherService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      ...overrides,
    } as unknown as LauncherService;
  });
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

describe("handleRestartInstance", () => {
  const originalExitCode = process.exitCode;
  let stdoutSpy: { mock: { calls: unknown[][] } };
  let stderrSpy: { mock: { calls: unknown[][] } };

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints human-readable message when instance was restarted", async () => {
    mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(makeResult());

    await handleRestartInstance("42", { cdpPort: 9222 });

    expect(process.exitCode).toBeUndefined();
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("42");
    expect(out).toContain("200"); // newPid
    expect(out).toContain("55002"); // cdpPort
    expect(out).toContain("verified");
  });

  it("prints 'already healthy' when restarted:false", async () => {
    mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(
      makeResult({ restarted: false, oldPid: 100, cdpPort: 55001 }),
    );

    await handleRestartInstance("42", { cdpPort: 9222 });

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("already healthy");
    expect(out).toContain("--force");
  });

  it("prints JSON output with --json flag", async () => {
    mockLauncher();
    const outcome = makeResult();
    vi.mocked(restartInstance).mockResolvedValue(outcome);

    await handleRestartInstance("42", { cdpPort: 9222, json: true });

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out) as RestartInstanceResult;
    expect(parsed.accountId).toBe(42);
    expect(parsed.restarted).toBe(true);
    expect(parsed.verified).toBe(true);
  });

  it("writes warning to stderr when verified:false", async () => {
    mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(
      makeResult({ verified: false, cdpPort: null }),
    );

    await handleRestartInstance("42", { cdpPort: 9222 });

    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toContain("verification failed");
  });

  it("sets exitCode 1 when restartInstance throws", async () => {
    mockLauncher();
    vi.mocked(restartInstance).mockRejectedValue(new Error("restart failed"));

    await handleRestartInstance("42", { cdpPort: 9222 });

    expect(process.exitCode).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toContain("restart failed");
  });

  it("sets exitCode 1 when launcher connect fails", async () => {
    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    await handleRestartInstance("42", { cdpPort: 9222 });

    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode 1 when port resolution fails", async () => {
    vi.mocked(resolveAppPort).mockRejectedValue(new Error("no launcher"));

    await handleRestartInstance("42", {});

    expect(process.exitCode).toBe(1);
  });

  it("uses explicit cdpPort when provided", async () => {
    mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(makeResult());

    await handleRestartInstance("42", { cdpPort: 4567 });

    expect(vi.mocked(LauncherService)).toHaveBeenCalledWith(4567, expect.anything());
  });

  it("passes force:true to restartInstance", async () => {
    mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(makeResult());

    await handleRestartInstance("42", { cdpPort: 9222, force: true });

    expect(vi.mocked(restartInstance)).toHaveBeenCalledWith(
      expect.anything(),
      42,
      9222,
      expect.objectContaining({ force: true }),
    );
  });

  it("annotates output with [launcher recovered] when launcherRecovered:true", async () => {
    mockLauncher();
    vi.mocked(restartInstance).mockResolvedValue(makeResult({ launcherRecovered: true }));

    await handleRestartInstance("42", { cdpPort: 9222 });

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("launcher recovered");
  });
});
