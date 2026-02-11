import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    DatabaseClient: vi.fn(),
    CampaignRepository: vi.fn(),
    discoverDatabase: vi.fn(),
  };
});

import {
  type Account,
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  type CampaignStatistics,
  DatabaseClient,
  discoverDatabase,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { registerCampaignStatistics } from "./campaign-statistics.js";
import { createMockServer } from "./testing/mock-server.js";

const SAMPLE_STATISTICS: CampaignStatistics = {
  campaignId: 10,
  actions: [
    {
      actionId: 1,
      actionName: "Invite",
      actionType: "InvitePerson",
      successful: 50,
      replied: 0,
      failed: 5,
      skipped: 0,
      total: 55,
      successRate: 90.9,
      firstResultAt: "2026-01-01T00:00:00Z",
      lastResultAt: "2026-01-15T00:00:00Z",
      topErrors: [
        { code: 270013, count: 3, isException: false, whoToBlame: "LinkedIn" },
        { code: 271403, count: 2, isException: false, whoToBlame: "LinkedIn" },
      ],
    },
  ],
  totals: {
    successful: 50,
    replied: 0,
    failed: 5,
    skipped: 0,
    total: 55,
    successRate: 90.9,
  },
};

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

function mockDb() {
  const close = vi.fn();
  vi.mocked(DatabaseClient).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

function mockCampaignRepo(
  overrides: Record<string, unknown> = {},
) {
  const getStatistics = vi.fn().mockReturnValue(SAMPLE_STATISTICS);
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getStatistics,
      ...overrides,
    } as unknown as CampaignRepository;
  });
  return { getStatistics };
}

function setupSuccessPath() {
  mockLauncher();
  mockDb();
  mockCampaignRepo();
  vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
}

describe("registerCampaignStatistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-statistics", () => {
    const { server } = createMockServer();
    registerCampaignStatistics(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-statistics",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns statistics for a campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);
    setupSuccessPath();

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      maxErrors: 5,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(SAMPLE_STATISTICS, null, 2),
        },
      ],
    });
  });

  it("passes actionId and maxErrors to getStatistics", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    mockLauncher();
    mockDb();
    const { getStatistics } = mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-statistics");
    await handler({
      campaignId: 10,
      actionId: 42,
      maxErrors: 3,
      cdpPort: 9222,
    });

    expect(getStatistics).toHaveBeenCalledWith(10, {
      actionId: 42,
      maxErrors: 3,
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getStatistics: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 999,
      cdpPort: 9222,
      maxErrors: 5,
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

  it("returns error for non-existent action", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getStatistics: vi.fn().mockImplementation(() => {
          throw new ActionNotFoundError(999, 10);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      actionId: 999,
      cdpPort: 9222,
      maxErrors: 5,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Action 999 not found in campaign 10.",
        },
      ],
    });
  });

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      maxErrors: 5,
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
    registerCampaignStatistics(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      maxErrors: 5,
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

  it("opens database in read-only mode", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    mockLauncher();
    mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-statistics");
    await handler({ campaignId: 10, cdpPort: 9222, maxErrors: 5 });

    // Default DatabaseClient constructor (no readOnly option) opens in read-only mode
    expect(vi.mocked(DatabaseClient)).toHaveBeenCalledWith("/path/to/db");
  });

  it("closes database after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-statistics");
    await handler({ campaignId: 10, cdpPort: 9222, maxErrors: 5 });

    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("closes database after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getStatistics: vi.fn().mockImplementation(() => {
          throw new Error("db error");
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-statistics");
    await handler({ campaignId: 10, cdpPort: 9222, maxErrors: 5 });

    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      maxErrors: 5,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No accounts found.",
        },
      ],
    });
  });

  it("returns error when multiple accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignStatistics(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 1, name: "Alice" },
        { id: 2, liId: 2, name: "Bob" },
      ]),
    });

    const handler = getHandler("campaign-statistics");
    const result = await handler({
      campaignId: 10,
      cdpPort: 9222,
      maxErrors: 5,
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
});
