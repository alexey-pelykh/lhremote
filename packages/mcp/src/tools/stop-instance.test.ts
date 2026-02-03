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

import { registerStopInstance } from "./stop-instance.js";
import { createMockServer } from "./testing/mock-server.js";

function mockLauncher(overrides: Record<string, unknown> = {}) {
  const disconnect = vi.fn();
  vi.mocked(LauncherService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listAccounts: vi.fn().mockResolvedValue([]),
      stopInstance: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

describe("registerStopInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named stop-instance", () => {
    const { server } = createMockServer();
    registerStopInstance(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "stop-instance",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns success when instance stopped", async () => {
    const { server, getHandler } = createMockServer();
    registerStopInstance(server);

    const stopInstance = vi.fn().mockResolvedValue(undefined);
    mockLauncher({ stopInstance });

    const handler = getHandler("stop-instance");
    const result = await handler({ accountId: 42, cdpPort: 9222 });

    expect(stopInstance).toHaveBeenCalledWith(42);
    expect(result).toEqual({
      content: [
        { type: "text", text: "Instance stopped for account 42" },
      ],
    });
  });

  it("auto-selects single account when accountId omitted", async () => {
    const { server, getHandler } = createMockServer();
    registerStopInstance(server);

    const accounts: Account[] = [
      { id: 42, liId: 42, name: "Alice" },
    ];

    const stopInstance = vi.fn().mockResolvedValue(undefined);
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue(accounts),
      stopInstance,
    });

    const handler = getHandler("stop-instance");
    const result = await handler({ cdpPort: 9222 });

    expect(stopInstance).toHaveBeenCalledWith(42);
    expect(result).toEqual({
      content: [
        { type: "text", text: "Instance stopped for account 42" },
      ],
    });
  });

  it("returns error when no accounts and accountId omitted", async () => {
    const { server, getHandler } = createMockServer();
    registerStopInstance(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    const handler = getHandler("stop-instance");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "No accounts found." }],
    });
  });

  it("returns error when multiple accounts and accountId omitted", async () => {
    const { server, getHandler } = createMockServer();
    registerStopInstance(server);

    const accounts: Account[] = [
      { id: 1, liId: 1, name: "Alice" },
      { id: 2, liId: 2, name: "Bob" },
    ];

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue(accounts),
    });

    const handler = getHandler("stop-instance");
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
    registerStopInstance(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("stop-instance");
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

  it("returns error on unexpected error", async () => {
    const { server, getHandler } = createMockServer();
    registerStopInstance(server);

    mockLauncher({
      stopInstance: vi
        .fn()
        .mockRejectedValue(new Error("unexpected failure")),
    });

    const handler = getHandler("stop-instance");
    const result = await handler({ accountId: 42, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to stop instance: unexpected failure",
        },
      ],
    });
  });

  it("passes cdpPort to LauncherService", async () => {
    const { server, getHandler } = createMockServer();
    registerStopInstance(server);

    mockLauncher();

    const handler = getHandler("stop-instance");
    await handler({ accountId: 42, cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567);
  });

  it("disconnects after successful call", async () => {
    const { server, getHandler } = createMockServer();
    registerStopInstance(server);

    const { disconnect } = mockLauncher();

    const handler = getHandler("stop-instance");
    await handler({ accountId: 42, cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects after error", async () => {
    const { server, getHandler } = createMockServer();
    registerStopInstance(server);

    const { disconnect } = mockLauncher({
      stopInstance: vi.fn().mockRejectedValue(new Error("fail")),
    });

    const handler = getHandler("stop-instance");
    await handler({ accountId: 42, cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
