// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

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
  type Account,
  LauncherService,
  LinkedHelperNotRunningError,
  startInstanceWithRecovery,
} from "@lhremote/core";

import { registerStartInstance } from "./start-instance.js";
import { createMockServer } from "./testing/mock-server.js";

function mockLauncher(overrides: Record<string, unknown> = {}) {
  const disconnect = vi.fn();
  vi.mocked(LauncherService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listAccounts: vi.fn().mockResolvedValue([]),
      startInstance: vi.fn().mockResolvedValue(undefined),
      stopInstance: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

describe("registerStartInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named start-instance", () => {
    const { server } = createMockServer();
    registerStartInstance(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "start-instance",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns success with account and port", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    mockLauncher();
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55123,
    });

    const handler = getHandler("start-instance");
    const result = await handler({ accountId: 42, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Instance started for account 42 on CDP port 55123",
        },
      ],
    });
  });

  it("auto-selects single account when accountId omitted", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    const accounts: Account[] = [
      { id: 42, liId: 42, name: "Alice" },
    ];

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue(accounts),
    });
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55123,
    });

    const handler = getHandler("start-instance");
    const result = await handler({ cdpPort: 9222 });

    expect(startInstanceWithRecovery).toHaveBeenCalledWith(
      expect.anything(),
      42,
      9222,
    );
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Instance started for account 42 on CDP port 55123",
        },
      ],
    });
  });

  it("returns error when no accounts and accountId omitted", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    const handler = getHandler("start-instance");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "No accounts found." }],
    });
  });

  it("returns error when multiple accounts and accountId omitted", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    const accounts: Account[] = [
      { id: 1, liId: 1, name: "Alice" },
      { id: 2, liId: 2, name: "Bob" },
    ];

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue(accounts),
    });

    const handler = getHandler("start-instance");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Multiple accounts found. Specify accountId. Use list-accounts to see available accounts.",
        },
      ],
    });
  });

  it("returns error when LinkedHelper not running", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("start-instance");
    const result = await handler({ accountId: 42, cdpPort: 9222 });

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

  it("treats 'already running' as idempotent success when port is discoverable", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    mockLauncher();
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "already_running",
      port: 55123,
    });

    const handler = getHandler("start-instance");
    const result = await handler({ accountId: 42, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Instance already running for account 42 on CDP port 55123",
        },
      ],
    });
  });

  it("returns error when instance fails to initialize within timeout", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    mockLauncher();
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "timeout",
    });

    const handler = getHandler("start-instance");
    const result = await handler({ accountId: 42, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Instance started but failed to initialize within timeout.",
        },
      ],
    });
  });

  it("returns error on unexpected error", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    mockLauncher();
    vi.mocked(startInstanceWithRecovery).mockRejectedValue(
      new Error("unexpected failure"),
    );

    const handler = getHandler("start-instance");
    const result = await handler({ accountId: 42, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to start instance: unexpected failure",
        },
      ],
    });
  });

  it("passes cdpPort to LauncherService", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    mockLauncher();
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55123,
    });

    const handler = getHandler("start-instance");
    await handler({ accountId: 42, cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567, {});
  });

  it("disconnects after successful call", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    const { disconnect } = mockLauncher();
    vi.mocked(startInstanceWithRecovery).mockResolvedValue({
      status: "started",
      port: 55123,
    });

    const handler = getHandler("start-instance");
    await handler({ accountId: 42, cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects after error", async () => {
    const { server, getHandler } = createMockServer();
    registerStartInstance(server);

    const { disconnect } = mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    const handler = getHandler("start-instance");
    await handler({ cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
