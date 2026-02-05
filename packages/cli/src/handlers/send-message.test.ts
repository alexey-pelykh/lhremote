import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    InstanceService: vi.fn(),
    discoverInstancePort: vi.fn(),
    parseMessageTemplate: actual.parseMessageTemplate,
  };
});

import {
  type Account,
  discoverInstancePort,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { handleSendMessage } from "./send-message.js";

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

describe("handleSendMessage", () => {
  let stdoutOutput: string[];
  let stderrOutput: string[];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutOutput = [];
    stderrOutput = [];
    process.exitCode = undefined;

    process.stdout.write = ((chunk: string) => {
      stdoutOutput.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: string) => {
      stderrOutput.push(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = undefined;
  });

  it("outputs success message in human-readable format", async () => {
    setupSuccessPath();

    await handleSendMessage(12345, "Hi {firstName}!", {});

    expect(stdoutOutput.join("")).toContain("Message sent to person 12345.");
    expect(process.exitCode).toBeUndefined();
  });

  it("outputs success message in JSON format", async () => {
    setupSuccessPath();

    await handleSendMessage(12345, "Hello!", { json: true });

    const output = JSON.parse(stdoutOutput.join("")) as Record<string, unknown>;
    expect(output).toEqual({
      success: true,
      personId: 12345,
      actionType: "MessageToPerson",
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("executes MessageToPerson action with correct config", async () => {
    mockLauncher();
    const executeAction = vi.fn().mockResolvedValue({ success: true });
    mockInstance({ executeAction });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    await handleSendMessage(12345, "Hi {firstName}, from {company}!", {});

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

  it("sets exit code 1 for invalid template variable", async () => {
    await handleSendMessage(12345, "Hi {unknownVar}!", {});

    expect(stderrOutput.join("")).toContain("Invalid message template");
    expect(process.exitCode).toBe(1);
  });

  it("sets exit code 1 when LinkedHelper not running", async () => {
    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    await handleSendMessage(12345, "Hello!", {});

    expect(stderrOutput.join("")).toContain("not running");
    expect(process.exitCode).toBe(1);
  });

  it("sets exit code 1 when no accounts found", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    await handleSendMessage(12345, "Hello!", {});

    expect(stderrOutput.join("")).toContain("No accounts found.");
    expect(process.exitCode).toBe(1);
  });

  it("sets exit code 1 when multiple accounts found", async () => {
    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 1, name: "Alice" },
        { id: 2, liId: 2, name: "Bob" },
      ]),
    });

    await handleSendMessage(12345, "Hello!", {});

    expect(stderrOutput.join("")).toContain(
      "Multiple accounts found. Cannot determine which instance to use.",
    );
    expect(process.exitCode).toBe(1);
  });

  it("sets exit code 1 when no instance is running", async () => {
    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    await handleSendMessage(12345, "Hello!", {});

    expect(stderrOutput.join("")).toContain(
      "No LinkedHelper instance is running",
    );
    expect(process.exitCode).toBe(1);
  });

  it("sets exit code 1 on action execution failure", async () => {
    mockLauncher();
    mockInstance({
      executeAction: vi.fn().mockRejectedValue(new Error("action failed")),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    await handleSendMessage(12345, "Hello!", {});

    expect(stderrOutput.join("")).toContain("action failed");
    expect(process.exitCode).toBe(1);
  });

  it("disconnects launcher after account lookup", async () => {
    const { disconnect: launcherDisconnect } = mockLauncher();
    mockInstance();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    await handleSendMessage(12345, "Hello!", {});

    expect(launcherDisconnect).toHaveBeenCalledOnce();
  });

  it("disconnects instance after success", async () => {
    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    await handleSendMessage(12345, "Hello!", {});

    expect(instanceDisconnect).toHaveBeenCalledOnce();
  });

  it("disconnects instance after error", async () => {
    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance({
      executeAction: vi.fn().mockRejectedValue(new Error("test error")),
    });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    await handleSendMessage(12345, "Hello!", {});

    expect(instanceDisconnect).toHaveBeenCalledOnce();
  });

  it("passes cdpPort option to LauncherService and discoverInstancePort", async () => {
    setupSuccessPath();

    await handleSendMessage(12345, "Hello!", { cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567);
    expect(discoverInstancePort).toHaveBeenCalledWith(4567);
  });

  it("uses default cdpPort when not specified", async () => {
    setupSuccessPath();

    await handleSendMessage(12345, "Hello!", {});

    expect(LauncherService).toHaveBeenCalledWith(9222);
    expect(discoverInstancePort).toHaveBeenCalledWith(9222);
  });

  it("passes discovered port to InstanceService", async () => {
    setupSuccessPath();

    await handleSendMessage(12345, "Hello!", {});

    expect(InstanceService).toHaveBeenCalledWith(55123);
  });

  it("handles plain message without variables", async () => {
    mockLauncher();
    const executeAction = vi.fn().mockResolvedValue({ success: true });
    mockInstance({ executeAction });
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);

    await handleSendMessage(12345, "Hello, nice to connect!", {});

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

  it("writes progress messages to stderr", async () => {
    setupSuccessPath();

    await handleSendMessage(12345, "Hello!", {});

    expect(stderrOutput.join("")).toContain("Sending message...");
    expect(stderrOutput.join("")).toContain("Done.");
  });
});
