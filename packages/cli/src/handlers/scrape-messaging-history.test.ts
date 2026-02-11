import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withInstanceDatabase: vi.fn(),
    MessageRepository: vi.fn(),
  };
});

import {
  InstanceNotRunningError,
  MessageRepository,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { handleScrapeMessagingHistory } from "./scrape-messaging-history.js";
import {
  mockResolveAccount,
  mockWithInstanceDatabase,
} from "./testing/mock-helpers.js";

const MOCK_STATS = {
  totalChats: 42,
  totalMessages: 256,
  earliestMessage: "2024-06-01T10:00:00Z",
  latestMessage: "2025-01-15T14:00:00Z",
};

function mockRepo(stats = MOCK_STATS) {
  vi.mocked(MessageRepository).mockImplementation(function () {
    return {
      getMessageStats: vi.fn().mockReturnValue(stats),
    } as unknown as MessageRepository;
  });
}

function setupSuccessPath() {
  mockResolveAccount();
  mockRepo();
  mockWithInstanceDatabase();
}

describe("handleScrapeMessagingHistory", () => {
  const originalExitCode = process.exitCode;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  function getStdout(): string {
    return stdoutSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join("");
  }

  function getStderr(): string {
    return stderrSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join("");
  }

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleScrapeMessagingHistory({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout());
    expect(output.success).toBe(true);
    expect(output.actionType).toBe("ScrapeMessagingHistory");
    expect(output.stats).toEqual(MOCK_STATS);
  });

  it("prints human-readable output by default", async () => {
    setupSuccessPath();

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("42 conversations");
    expect(output).toContain("256 messages");
    expect(output).toContain("2024-06-01");
    expect(output).toContain("2025-01-15");
  });

  it("prints progress to stderr", async () => {
    setupSuccessPath();

    await handleScrapeMessagingHistory({});

    const stderr = getStderr();
    expect(stderr).toContain("Scraping messaging history");
    expect(stderr).toContain("Done.");
  });

  it("omits date range when no messages", async () => {
    mockResolveAccount();
    mockRepo({
      totalChats: 0,
      totalMessages: 0,
      earliestMessage: null as unknown as string,
      latestMessage: null as unknown as string,
    });
    mockWithInstanceDatabase();

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("0 conversations");
    expect(output).not.toContain("Date range");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(
      new Error("No accounts found."),
    );

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBe(1);
    expect(getStderr()).toContain("No accounts found.");
  });

  it("sets exitCode 1 when instance not running", async () => {
    mockResolveAccount();
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError(
        "No LinkedHelper instance is running. Use start-instance first.",
      ),
    );

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBe(1);
    expect(getStderr()).toContain("No LinkedHelper instance is running.");
  });

  it("sets exitCode 1 on unexpected error", async () => {
    mockResolveAccount();
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("connection reset"),
    );

    await handleScrapeMessagingHistory({});

    expect(process.exitCode).toBe(1);
    expect(getStderr()).toContain("connection reset");
  });
});
