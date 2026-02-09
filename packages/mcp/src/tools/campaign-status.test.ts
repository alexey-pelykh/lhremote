import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    InstanceService: vi.fn(),
    DatabaseClient: vi.fn(),
    CampaignService: vi.fn(),
    discoverInstancePort: vi.fn(),
    discoverDatabase: vi.fn(),
  };
});

import {
  type Account,
  type ActionPeopleCounts,
  type CampaignActionResult,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { registerCampaignStatus } from "./campaign-status.js";
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
      ...overrides,
    } as unknown as InstanceService;
  });
  return { disconnect };
}

function mockDb() {
  const close = vi.fn();
  vi.mocked(DatabaseClient).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

const defaultStatus = {
  campaignState: "active" as const,
  isPaused: false,
  runnerState: "campaigns" as const,
  actionCounts: [
    { actionId: 1, queued: 10, processed: 5, successful: 4, failed: 1 },
  ] as ActionPeopleCounts[],
};

const defaultResults = {
  campaignId: 15,
  results: [
    {
      id: 1,
      actionVersionId: 1,
      personId: 123,
      result: 3,
      platform: "linkedin",
      createdAt: "2026-02-07T10:00:00Z",
    },
    {
      id: 2,
      actionVersionId: 1,
      personId: 456,
      result: 3,
      platform: "linkedin",
      createdAt: "2026-02-07T10:01:00Z",
    },
  ] as CampaignActionResult[],
  actionCounts: defaultStatus.actionCounts,
};

function mockCampaignService(overrides: Record<string, unknown> = {}) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      getStatus: vi.fn().mockResolvedValue(defaultStatus),
      getResults: vi.fn().mockResolvedValue(defaultResults),
      ...overrides,
    } as unknown as CampaignService;
  });
}

function setupSuccessPath() {
  mockLauncher();
  mockInstance();
  mockDb();
  mockCampaignService();
  vi.mocked(discoverInstancePort).mockResolvedValue(55123);
  vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
}

describe("registerCampaignStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-status", () => {
    const { server } = createMockServer();
    registerCampaignStatus(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-status",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns campaign status", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);
    setupSuccessPath();

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { campaignId: 15, ...defaultStatus },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns campaign status with results when includeResults=true", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);
    setupSuccessPath();

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: true,
      limit: 20,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              campaignId: 15,
              ...defaultStatus,
              results: defaultResults.results,
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("limits results when limit is specified", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);
    setupSuccessPath();

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: true,
      limit: 1,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              campaignId: 15,
              ...defaultStatus,
              results: [defaultResults.results[0]],
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        getStatus: vi
          .fn()
          .mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 999,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Campaign 999 not found.",
        },
      ],
    });
  });

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
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

  it("returns error when connection fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
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

  it("returns error when campaign execution fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        getStatus: vi
          .fn()
          .mockRejectedValue(
            new CampaignExecutionError(
              "Failed to get status for campaign 15: UI error",
              15,
            ),
          ),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-status");
    const result = await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to get campaign status: Failed to get status for campaign 15: UI error",
        },
      ],
    });
  });

  it("disconnects instance and closes db after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    mockCampaignService();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-status");
    await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
    });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("disconnects instance and closes db after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatus(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        getStatus: vi.fn().mockRejectedValue(new Error("test error")),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-status");
    await handler({
      campaignId: 15,
      includeResults: false,
      limit: 20,
      cdpPort: 9222,
    });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });
});
