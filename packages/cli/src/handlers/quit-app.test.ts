// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    AppService: vi.fn(),
  };
});

import { AppService } from "@lhremote/core";

import { handleQuitApp } from "./quit-app.js";

describe("handleQuitApp", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints success message on quit", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        quit: vi.fn().mockResolvedValue(undefined),
      } as unknown as AppService;
    });

    await handleQuitApp();

    expect(stdoutSpy).toHaveBeenCalledWith("LinkedHelper quit\n");
    expect(process.exitCode).toBeUndefined();
  });

  it("creates AppService with DEFAULT_CDP_PORT", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        quit: vi.fn().mockResolvedValue(undefined),
      } as unknown as AppService;
    });

    await handleQuitApp();

    expect(AppService).toHaveBeenCalledWith(9222);
  });

  it("sets exitCode 1 on error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        quit: vi.fn().mockRejectedValue(new Error("SIGTERM failed")),
      } as unknown as AppService;
    });

    await handleQuitApp();

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("SIGTERM failed\n");
  });
});
