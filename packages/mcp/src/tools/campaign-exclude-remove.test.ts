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
  DatabaseClient,
  discoverDatabase,
  ExcludeListNotFoundError,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { registerCampaignExcludeRemove } from "./campaign-exclude-remove.js";
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

function mockDb() {
  const close = vi.fn();
  vi.mocked(DatabaseClient).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

function mockCampaignRepo() {
  const removeFromExcludeList = vi.fn().mockReturnValue(1);
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      removeFromExcludeList,
    } as unknown as CampaignRepository;
  });
  return { removeFromExcludeList };
}

function setupSuccessPath() {
  mockLauncher();
  mockDb();
  mockCampaignRepo();
  vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
}

describe("registerCampaignExcludeRemove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-exclude-remove", () => {
    const { server } = createMockServer();
    registerCampaignExcludeRemove(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-exclude-remove",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully removes people from campaign-level exclude list", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);
    setupSuccessPath();

    const handler = getHandler("campaign-exclude-remove");
    const result = await handler({
      campaignId: 10,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              campaignId: 10,
              level: "campaign",
              removed: 1,
              notInList: 1,
              message:
                "Removed 1 person(s) from exclude list for campaign 10.",
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("calls removeFromExcludeList with correct arguments for campaign-level", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    mockLauncher();
    mockDb();
    const { removeFromExcludeList } = mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-exclude-remove");
    await handler({
      campaignId: 10,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(removeFromExcludeList).toHaveBeenCalledWith(
      10,
      [100, 200],
      undefined,
    );
  });

  it("calls removeFromExcludeList with correct arguments for action-level", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    mockLauncher();
    mockDb();
    const { removeFromExcludeList } = mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-exclude-remove");
    await handler({
      campaignId: 10,
      personIds: [100, 200],
      actionId: 5,
      cdpPort: 9222,
    });

    expect(removeFromExcludeList).toHaveBeenCalledWith(10, [100, 200], 5);
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        removeFromExcludeList: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-exclude-remove");
    const result = await handler({
      campaignId: 999,
      personIds: [100, 200],
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

  it("returns error for non-existent action", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        removeFromExcludeList: vi.fn().mockImplementation(() => {
          throw new ActionNotFoundError(5, 10);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-exclude-remove");
    const result = await handler({
      campaignId: 10,
      personIds: [100, 200],
      actionId: 5,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Action 5 not found in campaign 10.",
        },
      ],
    });
  });

  it("returns error for non-existent exclude list", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        removeFromExcludeList: vi.fn().mockImplementation(() => {
          throw new ExcludeListNotFoundError("campaign", 10);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-exclude-remove");
    const result = await handler({
      campaignId: 10,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Exclude list not found for campaign 10",
        },
      ],
    });
  });

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-exclude-remove");
    const result = await handler({
      campaignId: 10,
      personIds: [100, 200],
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
    registerCampaignExcludeRemove(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-exclude-remove");
    const result = await handler({
      campaignId: 10,
      personIds: [100, 200],
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

  it("opens database in writable mode", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    mockLauncher();
    mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-exclude-remove");
    await handler({ campaignId: 10, personIds: [100], cdpPort: 9222 });

    expect(vi.mocked(DatabaseClient)).toHaveBeenCalledWith("/path/to/db", {
      readOnly: false,
    });
  });

  it("closes database after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-exclude-remove");
    await handler({ campaignId: 10, personIds: [100], cdpPort: 9222 });

    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("closes database after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExcludeRemove(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        removeFromExcludeList: vi.fn().mockImplementation(() => {
          throw new Error("db error");
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-exclude-remove");
    await handler({ campaignId: 10, personIds: [100], cdpPort: 9222 });

    expect(dbClose).toHaveBeenCalledOnce();
  });
});
