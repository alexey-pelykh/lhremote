import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    startInstanceWithRecovery: vi.fn(),
  };
});

import {
  LauncherService,
  LinkedHelperNotRunningError,
  startInstanceWithRecovery,
} from "@lhremote/core";

import { handleStartInstance } from "./start-instance.js";

describe("handleStartInstance", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints success with port on successful start", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55123,
    });

    await handleStartInstance("42", {});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Instance started for account 42 on CDP port 55123\n",
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

    await handleStartInstance("42", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("not running"),
    );
  });

  it("handles idempotent 'already running' when port available", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "already_running",
      port: 55123,
    });

    await handleStartInstance("42", {});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Instance already running for account 42 on CDP port 55123\n",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("sets exitCode 1 on unexpected error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });
    vi.mocked(startInstanceWithRecovery).mockRejectedValue(
      new Error("unexpected failure"),
    );

    await handleStartInstance("42", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("unexpected failure"),
    );
  });

  it("passes cdpPort option to LauncherService", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55123,
    });

    await handleStartInstance("42", { cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567);
  });

  it("sets exitCode 1 when instance fails to initialize within timeout", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "timeout",
    });

    await handleStartInstance("42", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Instance started but failed to initialize within timeout.\n",
    );
  });
});
