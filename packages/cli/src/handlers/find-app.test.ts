// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    findApp: vi.fn(),
  };
});

import { type DiscoveredApp, findApp } from "@lhremote/core";

import { handleFindApp } from "./find-app.js";
import { getStdout } from "./testing/mock-helpers.js";

describe("handleFindApp", () => {
  const originalExitCode = process.exitCode;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints JSON with --json", async () => {
    const apps: DiscoveredApp[] = [
      { pid: 1234, cdpPort: 9222, connectable: true },
    ];
    vi.mocked(findApp).mockResolvedValue(apps);

    await handleFindApp({ json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed).toEqual(apps);
  });

  it("prints human-readable output for connectable instance", async () => {
    vi.mocked(findApp).mockResolvedValue([
      { pid: 1234, cdpPort: 9222, connectable: true },
    ]);

    await handleFindApp({});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("PID 1234");
    expect(getStdout(stdoutSpy)).toContain("CDP port 9222");
    expect(getStdout(stdoutSpy)).toContain("connectable");
  });

  it("prints 'not connectable' for non-connectable instance", async () => {
    vi.mocked(findApp).mockResolvedValue([
      { pid: 5678, cdpPort: 9222, connectable: false },
    ]);

    await handleFindApp({});

    expect(getStdout(stdoutSpy)).toContain("not connectable");
  });

  it("prints 'no CDP port' when cdpPort is null", async () => {
    vi.mocked(findApp).mockResolvedValue([
      { pid: 5678, cdpPort: null, connectable: false },
    ]);

    await handleFindApp({});

    expect(getStdout(stdoutSpy)).toContain("no CDP port");
  });

  it("prints message when no instances found", async () => {
    vi.mocked(findApp).mockResolvedValue([]);

    await handleFindApp({});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("No running LinkedHelper instances found");
  });

  it("sets exitCode 1 on error", async () => {
    vi.mocked(findApp).mockRejectedValue(new Error("scan failed"));

    await handleFindApp({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("scan failed\n");
  });
});
