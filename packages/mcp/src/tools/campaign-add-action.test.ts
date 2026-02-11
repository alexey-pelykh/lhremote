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
  type CampaignAction,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { registerCampaignAddAction } from "./campaign-add-action.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_ACTION: CampaignAction = {
  id: 50,
  campaignId: 15,
  name: "Visit & Extract",
  description: null,
  config: {
    id: 500,
    actionType: "VisitAndExtract",
    actionSettings: {},
    coolDown: 60000,
    maxActionResultsPerIteration: 10,
    isDraft: false,
  },
  versionId: 5000,
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

function mockCampaignRepo(overrides: Record<string, unknown> = {}) {
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getCampaign: vi.fn().mockReturnValue({
        id: 15,
        name: "Test Campaign",
        liAccountId: 1,
      }),
      addAction: vi.fn().mockReturnValue(MOCK_ACTION),
      ...overrides,
    } as unknown as CampaignRepository;
  });
}

function setupSuccessPath() {
  mockLauncher();
  mockDb();
  mockCampaignRepo();
  vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
}

describe("registerCampaignAddAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-add-action", () => {
    const { server } = createMockServer();
    registerCampaignAddAction(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-add-action",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully adds action with required params", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignAddAction(server);
    setupSuccessPath();

    const handler = getHandler("campaign-add-action");
    const result = await handler({
      campaignId: 15,
      name: "Visit & Extract",
      actionType: "VisitAndExtract",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_ACTION, null, 2),
        },
      ],
    });
  });

  it("returns error for invalid actionSettings JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignAddAction(server);

    const handler = getHandler("campaign-add-action");
    const result = await handler({
      campaignId: 15,
      name: "Visit & Extract",
      actionType: "VisitAndExtract",
      actionSettings: "{not-valid-json",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Invalid JSON in actionSettings.",
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignAddAction(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
        addAction: vi.fn(),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-add-action");
    const result = await handler({
      campaignId: 999,
      name: "Visit",
      actionType: "VisitAndExtract",
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
    registerCampaignAddAction(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-add-action");
    const result = await handler({
      campaignId: 15,
      name: "Visit",
      actionType: "VisitAndExtract",
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

  it("opens database in writable mode", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignAddAction(server);

    mockLauncher();
    mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-add-action");
    await handler({
      campaignId: 15,
      name: "Visit",
      actionType: "VisitAndExtract",
      cdpPort: 9222,
    });

    expect(vi.mocked(DatabaseClient)).toHaveBeenCalledWith("/path/to/db", {
      readOnly: false,
    });
  });

  it("closes database after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignAddAction(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-add-action");
    await handler({
      campaignId: 15,
      name: "Visit",
      actionType: "VisitAndExtract",
      cdpPort: 9222,
    });

    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("closes database after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignAddAction(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockImplementation(() => {
          throw new Error("db error");
        }),
        addAction: vi.fn(),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-add-action");
    await handler({
      campaignId: 15,
      name: "Visit",
      actionType: "VisitAndExtract",
      cdpPort: 9222,
    });

    expect(dbClose).toHaveBeenCalledOnce();
  });
});
