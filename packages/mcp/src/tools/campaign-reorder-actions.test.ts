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
  type CampaignAction,
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignService,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { registerCampaignReorderActions } from "./campaign-reorder-actions.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_ACTIONS: CampaignAction[] = [
  {
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
  },
  {
    id: 51,
    campaignId: 15,
    name: "Send Message",
    description: null,
    config: {
      id: 501,
      actionType: "MessageToPerson",
      actionSettings: {},
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 5001,
  },
];

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

function mockCampaignService(
  actions: CampaignAction[] = MOCK_ACTIONS,
  overrides: Record<string, unknown> = {},
) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      reorderActions: vi.fn().mockResolvedValue(actions),
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

describe("registerCampaignReorderActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-reorder-actions", () => {
    const { server } = createMockServer();
    registerCampaignReorderActions(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-reorder-actions",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully reorders actions", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);
    setupSuccessPath();

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [51, 50],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              campaignId: 15,
              actions: MOCK_ACTIONS,
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
    registerCampaignReorderActions(server);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        reorderActions: vi
          .fn()
          .mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 999,
      actionIds: [50, 51],
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

  it("returns error for invalid action IDs", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        reorderActions: vi
          .fn()
          .mockRejectedValue(new ActionNotFoundError(999, 15)),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [999, 50],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "One or more action IDs not found in campaign 15.",
        },
      ],
    });
  });

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [50, 51],
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

  it("returns error when instance is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    const handler = getHandler("campaign-reorder-actions");
    const result = await handler({
      campaignId: 15,
      actionIds: [50, 51],
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

  it("disconnects instance and closes db after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    mockCampaignService();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-reorder-actions");
    await handler({ campaignId: 15, actionIds: [51, 50], cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("disconnects instance and closes db after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignReorderActions(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        reorderActions: vi.fn().mockRejectedValue(new Error("test error")),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-reorder-actions");
    await handler({ campaignId: 15, actionIds: [51, 50], cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });
});
