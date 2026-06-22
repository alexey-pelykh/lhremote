// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    AppService: vi.fn(),
    resolveLauncherPort: vi.fn().mockRejectedValue(new Error("not running")),
  };
});

import { AppService, resolveLauncherPort } from "@insoftex/lhremote-core";

import { handleQuitApp } from "./quit-app.js";

describe("handleQuitApp", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    vi.mocked(resolveLauncherPort).mockRejectedValue(new Error("not running"));
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

  it("uses discovered launcher port when available", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.mocked(resolveLauncherPort).mockResolvedValue(51544);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        quit: vi.fn().mockResolvedValue(undefined),
      } as unknown as AppService;
    });

    await handleQuitApp();

    expect(AppService).toHaveBeenCalledWith(51544);
  });

  it("uses explicit cdpPort without discovery", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        quit: vi.fn().mockResolvedValue(undefined),
      } as unknown as AppService;
    });

    await handleQuitApp({ cdpPort: 4567 });

    expect(resolveLauncherPort).not.toHaveBeenCalled();
    expect(AppService).toHaveBeenCalledWith(4567);
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
