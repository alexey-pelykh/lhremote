import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    InstanceService: vi.fn(),
    discoverInstancePort: vi.fn(),
    // Keep actual parseMessageTemplate since we test it indirectly
    parseMessageTemplate: actual.parseMessageTemplate,
  };
});

import {
  type Account,
  discoverInstancePort,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { registerSendMessage } from "./send-message.js";
import { createMockServer } from "./testing/mock-server.js";

function mockLauncher(overrides: Record<string, unknown> = {}) {
  const disconnect = vi.fn();
  vi.mocked(LauncherService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ id: 1, liId: 1, name: "Alice" } as Account]),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

function mockInstance(overrides: Record<string, unknown> = {}) {
  const disconnect = vi.fn();
  vi.mocked(InstanceService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      executeAction: vi.fn().mockResolvedValue({ success: true }),
      ...overrides,
    } as unknown as InstanceService;
  });
  return { disconnect };
}

function setupSuccessPath() {
  mockLauncher();
  mockInstance();
  vi.mocked(discoverInstancePort).mockResolvedValue(55123);
}

describe("registerSendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named send-message", () => {
    const { server } = createMockServer();
    registerSendMessage(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "send-message",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns success on valid message", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);
    setupSuccessPath();

    const handler = getHandler("send-message");
    const result = await handler({
      personId: 12345,
      message: "Hi {firstName}, great connecting!",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              personId: 12345,
              actionType: "MessageToPerson",
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("executes MessageToPerson action with correct config", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    mockLauncher();
    const executeAction = vi.fn().mockResolvedValue({ success: true });
    mockInstance({ executeAction });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const handler = getHandler("send-message");
    await handler({
      personId: 12345,
      message: "Hi {firstName}, from {company}!",
      cdpPort: 9222,
    });

    expect(executeAction).toHaveBeenCalledWith("MessageToPerson", {
      personIds: [12345],
      messageTemplate: [
        {
          valueParts: ["Hi ", ", from ", "!"],
          variables: ["firstName", "company"],
        },
      ],
    });
  });

  it("returns error for invalid template variable", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    const handler = getHandler("send-message");
    const result = await handler({
      personId: 12345,
      message: "Hi {unknownVar}!",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining("Invalid message template"),
        },
      ],
    });
  });

  it("returns error when LinkedHelper not running", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("send-message");
    const result = await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

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

  it("returns error when launcher connect fails with unknown error", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("send-message");
    const result = await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to connect to LinkedHelper: connection refused",
        },
      ],
    });
  });

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    const handler = getHandler("send-message");
    const result = await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "No accounts found." }],
    });
  });

  it("returns error when multiple accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 1, name: "Alice" },
        { id: 2, liId: 2, name: "Bob" },
      ]),
    });

    const handler = getHandler("send-message");
    const result = await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Multiple accounts found. Cannot determine which instance to use.",
        },
      ],
    });
  });

  it("returns error when no instance is running", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    const handler = getHandler("send-message");
    const result = await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No LinkedHelper instance is running. Use start-instance first.",
        },
      ],
    });
  });

  it("returns error when instance connect fails", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(InstanceService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(
            new InstanceNotRunningError("LinkedIn webview target not found"),
          ),
        disconnect: vi.fn(),
      } as unknown as InstanceService;
    });

    const handler = getHandler("send-message");
    const result = await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No LinkedHelper instance is running. Use start-instance first.",
        },
      ],
    });
  });

  it("returns error on action execution failure", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    mockLauncher();
    mockInstance({
      executeAction: vi.fn().mockRejectedValue(new Error("action failed")),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const handler = getHandler("send-message");
    const result = await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to send message: action failed",
        },
      ],
    });
  });

  it("disconnects launcher after account lookup", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    const { disconnect: launcherDisconnect } = mockLauncher();
    mockInstance();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const handler = getHandler("send-message");
    await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(launcherDisconnect).toHaveBeenCalledOnce();
  });

  it("disconnects instance after success", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const handler = getHandler("send-message");
    await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
  });

  it("disconnects instance after error", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance({
      executeAction: vi.fn().mockRejectedValue(new Error("test error")),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const handler = getHandler("send-message");
    await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
  });

  it("passes cdpPort to LauncherService and discoverInstancePort", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    setupSuccessPath();

    const handler = getHandler("send-message");
    await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 4567,
    });

    expect(LauncherService).toHaveBeenCalledWith(4567);
    expect(discoverInstancePort).toHaveBeenCalledWith(4567);
  });

  it("passes discovered port to InstanceService", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    setupSuccessPath();

    const handler = getHandler("send-message");
    await handler({
      personId: 12345,
      message: "Hello!",
      cdpPort: 9222,
    });

    expect(InstanceService).toHaveBeenCalledWith(55123);
  });

  it("handles plain message without variables", async () => {
    const { server, getHandler } = createMockServer();
    registerSendMessage(server);

    mockLauncher();
    const executeAction = vi.fn().mockResolvedValue({ success: true });
    mockInstance({ executeAction });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    const handler = getHandler("send-message");
    await handler({
      personId: 12345,
      message: "Hello, nice to connect!",
      cdpPort: 9222,
    });

    expect(executeAction).toHaveBeenCalledWith("MessageToPerson", {
      personIds: [12345],
      messageTemplate: [
        {
          valueParts: ["Hello, nice to connect!"],
          variables: [],
        },
      ],
    });
  });
});
