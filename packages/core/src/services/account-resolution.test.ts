// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./launcher.js", () => ({
  LauncherService: vi.fn(),
}));

import { LinkedHelperNotRunningError } from "./errors.js";
import { LauncherService } from "./launcher.js";
import { AccountResolutionError, resolveAccount } from "./account-resolution.js";

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the account ID when exactly one account exists", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 42, liId: 100, name: "Alice", email: "alice@test.com" },
      ]),
    });

    const id = await resolveAccount(9222);

    expect(id).toBe(42);
    expect(mockedLauncherService).toHaveBeenCalledWith(9222);
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
});
