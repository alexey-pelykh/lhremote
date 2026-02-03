import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
  };
});

import {
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { handleStopInstance } from "./stop-instance.js";

describe("handleStopInstance", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints success on successful stop", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        stopInstance: vi.fn().mockResolvedValue(undefined),
      } as unknown as LauncherService;
    });

    await handleStopInstance("42", {});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Instance stopped for account 42\n",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("sets exitCode 1 on connection error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    await handleStopInstance("42", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("not running"),
    );
  });

  it("sets exitCode 1 on unexpected error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        stopInstance: vi
          .fn()
          .mockRejectedValue(new Error("unexpected failure")),
      } as unknown as LauncherService;
    });

    await handleStopInstance("42", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("unexpected failure\n");
  });

  it("passes cdpPort option to LauncherService", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        stopInstance: vi.fn().mockResolvedValue(undefined),
      } as unknown as LauncherService;
    });

    await handleStopInstance("42", { cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567);
  });
});
