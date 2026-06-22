// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    AppService: vi.fn(),
  };
});

import { AppNotFoundError, AppService } from "@insoftex/lhremote-core";

import { handleLaunchApp } from "./launch-app.js";

describe("handleLaunchApp", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints port on successful launch", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        launch: vi.fn().mockResolvedValue(undefined),
        cdpPort: 9222,
      } as unknown as AppService;
    });

    await handleLaunchApp();

    expect(stdoutSpy).toHaveBeenCalledWith(
      "LinkedHelper launched on CDP port 9222\n",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("creates AppService without explicit port", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        launch: vi.fn().mockResolvedValue(undefined),
        cdpPort: 9222,
      } as unknown as AppService;
    });

    await handleLaunchApp();

    expect(AppService).toHaveBeenCalledWith(undefined, {
      launchProbeDelay: 10000,
    });
  });

  it("passes force through to AppService when requested", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        launch: vi.fn().mockResolvedValue(undefined),
        cdpPort: 9222,
      } as unknown as AppService;
    });

    await handleLaunchApp({ force: true });

    expect(AppService).toHaveBeenCalledWith(undefined, {
      launchProbeDelay: 10000,
      force: true,
    });
  });

  it("passes visible through to AppService when explicitly disabled", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        launch: vi.fn().mockResolvedValue(undefined),
        cdpPort: 9222,
      } as unknown as AppService;
    });

    await handleLaunchApp({ visible: false });

    expect(AppService).toHaveBeenCalledWith(undefined, {
      launchProbeDelay: 10000,
      visible: false,
    });
  });

  it("sets exitCode 1 on error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        launch: vi
          .fn()
          .mockRejectedValue(
            new AppNotFoundError("Binary not found at /foo"),
          ),
      } as unknown as AppService;
    });

    await handleLaunchApp();

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Binary not found at /foo\n",
    );
  });
});
