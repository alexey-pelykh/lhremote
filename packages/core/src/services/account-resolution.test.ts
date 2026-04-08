// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/index.js", () => ({
  resolveLauncherPort: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  discoverAllDatabases: vi.fn(),
}));

vi.mock("./launcher.js", () => ({
  LauncherService: vi.fn(),
}));

import { resolveLauncherPort } from "../cdp/index.js";
import { discoverAllDatabases } from "../db/index.js";
import {
  LinkedHelperNotRunningError,
  LinkedHelperUnreachableError,
  WrongPortError,
} from "./errors.js";
import { LauncherService } from "./launcher.js";
import { AccountResolutionError, resolveAccount } from "./account-resolution.js";

const mockedResolveLauncherPort = vi.mocked(resolveLauncherPort);
const mockedDiscoverAllDatabases = vi.mocked(discoverAllDatabases);

const mockedLauncherService = vi.mocked(LauncherService);

function mockLauncher(overrides: Partial<LauncherService> = {}) {
  const disconnect = vi.fn();
  mockedLauncherService.mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listAccounts: vi.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

describe("resolveAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveLauncherPort.mockResolvedValue(9222);
    mockedDiscoverAllDatabases.mockReturnValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns explicit accountId without contacting the launcher", async () => {
    const id = await resolveAccount(9222, { accountId: 77 });

    expect(id).toBe(77);
    expect(mockedLauncherService).not.toHaveBeenCalled();
  });

  it("returns the account ID when exactly one account exists", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 42, liId: 100, name: "Alice", email: "alice@test.com" },
      ]),
    });

    const id = await resolveAccount(9222);

    expect(id).toBe(42);
    expect(mockedLauncherService).toHaveBeenCalledWith(9222, undefined);
  });

  it("throws AccountResolutionError with reason 'no-accounts' when no accounts exist", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    await expect(resolveAccount(9222)).rejects.toThrow(AccountResolutionError);
    await expect(resolveAccount(9222)).rejects.toMatchObject({
      reason: "no-accounts",
    });
  });

  it("throws AccountResolutionError with reason 'multiple-accounts' when multiple accounts exist", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 100, name: "Alice" },
        { id: 2, liId: 200, name: "Bob" },
      ]),
    });

    await expect(resolveAccount(9222)).rejects.toThrow(AccountResolutionError);
    await expect(resolveAccount(9222)).rejects.toMatchObject({
      reason: "multiple-accounts",
    });
  });

  it("propagates CDP connection failure from launcher.connect()", async () => {
    mockLauncher({
      connect: vi.fn().mockRejectedValue(
        new LinkedHelperNotRunningError(9222),
      ),
    });

    await expect(resolveAccount(9222)).rejects.toThrow(
      LinkedHelperNotRunningError,
    );
  });

  it("calls disconnect in the finally block on success", async () => {
    const { disconnect } = mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 100, name: "Alice" },
      ]),
    });

    await resolveAccount(9222);

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("calls disconnect in the finally block on AccountResolutionError", async () => {
    const { disconnect } = mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    await expect(resolveAccount(9222)).rejects.toThrow(AccountResolutionError);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("calls disconnect in the finally block on connection failure", async () => {
    const { disconnect } = mockLauncher({
      connect: vi.fn().mockRejectedValue(
        new LinkedHelperNotRunningError(9222),
      ),
    });

    await expect(resolveAccount(9222)).rejects.toThrow(
      LinkedHelperNotRunningError,
    );
    expect(disconnect).toHaveBeenCalledOnce();
  });

  describe("database fallback", () => {
    it("falls back to databases when launcher is not running and cdpPort is omitted", async () => {
      mockedResolveLauncherPort.mockRejectedValue(
        new LinkedHelperNotRunningError(),
      );
      mockedDiscoverAllDatabases.mockReturnValue(
        new Map([[42, "/path/to/lh.db"]]),
      );

      const id = await resolveAccount();

      expect(id).toBe(42);
      expect(mockedLauncherService).not.toHaveBeenCalled();
    });

    it("does NOT fall back to databases on LinkedHelperUnreachableError", async () => {
      mockedResolveLauncherPort.mockRejectedValue(
        new LinkedHelperUnreachableError([]),
      );

      await expect(resolveAccount()).rejects.toThrow(
        LinkedHelperUnreachableError,
      );
      expect(mockedDiscoverAllDatabases).not.toHaveBeenCalled();
    });

    it("propagates LinkedHelperNotRunningError when cdpPort is explicit", async () => {
      mockLauncher({
        connect: vi.fn().mockRejectedValue(
          new LinkedHelperNotRunningError(9222),
        ),
      });

      await expect(resolveAccount(9222)).rejects.toThrow(
        LinkedHelperNotRunningError,
      );
      expect(mockedDiscoverAllDatabases).not.toHaveBeenCalled();
    });

    it("falls back to databases on WrongPortError", async () => {
      mockLauncher({
        connect: vi.fn().mockRejectedValue(new WrongPortError(9222)),
      });
      mockedDiscoverAllDatabases.mockReturnValue(
        new Map([[99, "/path/to/lh.db"]]),
      );

      const id = await resolveAccount(9222);

      expect(id).toBe(99);
    });

    it("throws no-accounts when database fallback finds no databases", async () => {
      mockedResolveLauncherPort.mockRejectedValue(
        new LinkedHelperNotRunningError(),
      );
      mockedDiscoverAllDatabases.mockReturnValue(new Map());

      await expect(resolveAccount()).rejects.toThrow(AccountResolutionError);
      await expect(resolveAccount()).rejects.toMatchObject({
        reason: "no-accounts",
      });
    });

    it("throws multiple-accounts with IDs when database fallback finds multiple", async () => {
      mockedResolveLauncherPort.mockRejectedValue(
        new LinkedHelperNotRunningError(),
      );
      mockedDiscoverAllDatabases.mockReturnValue(
        new Map([
          [10996, "/path/10996/lh.db"],
          [363386, "/path/363386/lh.db"],
          [999999, "/path/999999/lh.db"],
        ]),
      );

      await expect(resolveAccount()).rejects.toThrow(AccountResolutionError);
      await expect(resolveAccount()).rejects.toMatchObject({
        reason: "multiple-accounts",
        message: expect.stringContaining("10996"),
      });
    });
  });
});
