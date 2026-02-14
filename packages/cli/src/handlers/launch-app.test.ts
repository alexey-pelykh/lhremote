// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    AppService: vi.fn(),
  };
});

import { AppNotFoundError, AppService } from "@lhremote/core";

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

    expect(AppService).toHaveBeenCalledWith();
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
