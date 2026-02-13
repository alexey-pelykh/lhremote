// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
  };
});

import {
  type Account,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { handleListAccounts } from "./list-accounts.js";
import { mockLauncher } from "./testing/mock-helpers.js";

describe("handleListAccounts", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints JSON array with --json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    const accounts: Account[] = [
      { id: 1, liId: 100, name: "Alice" },
      { id: 2, liId: 200, name: "Bob", email: "bob@example.com" },
    ];

    mockLauncher({ listAccounts: vi.fn().mockResolvedValue(accounts) });

    await handleListAccounts({ json: true });

    const firstCall = stdoutSpy.mock.calls[0] as [string];
    expect(JSON.parse(firstCall[0])).toEqual(accounts);
  });

  it("prints formatted table by default", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    const accounts: Account[] = [
      { id: 1, liId: 100, name: "Alice" },
      { id: 2, liId: 200, name: "Bob", email: "bob@example.com" },
    ];

    mockLauncher({ listAccounts: vi.fn().mockResolvedValue(accounts) });

    await handleListAccounts({});

    expect(stdoutSpy).toHaveBeenCalledWith("1\tAlice\n");
    expect(stdoutSpy).toHaveBeenCalledWith("2\tBob <bob@example.com>\n");
  });

  it("prints message when no accounts", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockLauncher({ listAccounts: vi.fn().mockResolvedValue([]) });

    await handleListAccounts({});

    expect(stdoutSpy).toHaveBeenCalledWith("No accounts found\n");
  });

  it("sets exitCode 1 when not running", async () => {
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

    await handleListAccounts({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("passes cdpPort to LauncherService", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockLauncher();

    await handleListAccounts({ cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567, {});
  });

  it("disconnects after successful call", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const { disconnect } = mockLauncher();

    await handleListAccounts({});

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
