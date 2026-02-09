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
  type CampaignSummary,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  LauncherService,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

import { registerCampaignList } from "./campaign-list.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_CAMPAIGNS: CampaignSummary[] = [
  {
    id: 15,
    name: "Outreach Campaign",
    description: "Connect with engineering leaders",
    state: "active",
    liAccountId: 1,
    actionCount: 2,
    createdAt: "2026-02-07T10:00:00Z",
  },
  {
    id: 16,
    name: "Follow-up Campaign",
    description: null,
    state: "paused",
    liAccountId: 1,
    actionCount: 1,
    createdAt: "2026-02-08T10:00:00Z",
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

function mockDb() {
  const close = vi.fn();
  vi.mocked(DatabaseClient).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

function mockCampaignRepo(campaigns: CampaignSummary[] = MOCK_CAMPAIGNS) {
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      listCampaigns: vi.fn().mockReturnValue(campaigns),
    } as unknown as CampaignRepository;
  });
}

function setupSuccessPath(campaigns?: CampaignSummary[]) {
  mockLauncher();
  mockDb();
  mockCampaignRepo(campaigns);
  vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
}

describe("registerCampaignList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-list", () => {
    const { server } = createMockServer();
    registerCampaignList(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-list",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns list of campaigns", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);
    setupSuccessPath();

    const handler = getHandler("campaign-list");
    const result = await handler({ includeArchived: false, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { campaigns: MOCK_CAMPAIGNS, total: 2 },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns empty list when no campaigns", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);
    setupSuccessPath([]);

    const handler = getHandler("campaign-list");
    const result = await handler({ includeArchived: false, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ campaigns: [], total: 0 }, null, 2),
        },
      ],
    });
  });

  it("passes includeArchived option to repository", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);
    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const listCampaigns = vi.fn().mockReturnValue([]);
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return { listCampaigns } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-list");
    await handler({ includeArchived: true, cdpPort: 9222 });

    expect(listCampaigns).toHaveBeenCalledWith({ includeArchived: true });
  });

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-list");
    const result = await handler({ includeArchived: false, cdpPort: 9222 });

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
    registerCampaignList(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-list");
    const result = await handler({ includeArchived: false, cdpPort: 9222 });

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

  it("closes database after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-list");
    await handler({ includeArchived: false, cdpPort: 9222 });

    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("closes database after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignList(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        listCampaigns: vi.fn().mockImplementation(() => {
          throw new Error("db error");
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-list");
    await handler({ includeArchived: false, cdpPort: 9222 });

    expect(dbClose).toHaveBeenCalledOnce();
  });
});
