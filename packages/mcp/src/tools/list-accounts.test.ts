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

import { registerListAccounts } from "./list-accounts.js";
import { createMockServer } from "./testing/mock-server.js";

function mockLauncher(overrides: Partial<LauncherService> = {}) {
  const disconnect = vi.fn();
  vi.mocked(LauncherService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listAccounts: vi.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

describe("registerListAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named list-accounts", () => {
    const { server } = createMockServer();
    registerListAccounts(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "list-accounts",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns accounts as JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerListAccounts(server);

    const accounts: Account[] = [
      { id: 1, liId: 100, name: "Alice" },
      { id: 2, liId: 200, name: "Bob", email: "bob@example.com" },
    ];

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue(accounts),
    });

    const handler = getHandler("list-accounts");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    expect(JSON.parse(result.content[0].text)).toEqual(accounts);
  });

  it("returns empty array when no accounts", async () => {
    const { server, getHandler } = createMockServer();
    registerListAccounts(server);

    mockLauncher({ listAccounts: vi.fn().mockResolvedValue([]) });

    const handler = getHandler("list-accounts");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  it("returns error when LinkedHelper not running", async () => {
    const { server, getHandler } = createMockServer();
    registerListAccounts(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("list-accounts");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "LinkedHelper is not running. Use launch-app first.",
        },
      ],
    });
  });

  it("disconnects after successful call", async () => {
    const { server, getHandler } = createMockServer();
    registerListAccounts(server);

    const { disconnect } = mockLauncher();

    const handler = getHandler("list-accounts");
    await handler({ cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("passes cdpPort to LauncherService", async () => {
    const { server, getHandler } = createMockServer();
    registerListAccounts(server);

    mockLauncher();

    const handler = getHandler("list-accounts");
    await handler({ cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567, {});
  });
});
