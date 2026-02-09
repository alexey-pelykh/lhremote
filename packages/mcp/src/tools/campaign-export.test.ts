import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    DatabaseClient: vi.fn(),
    CampaignRepository: vi.fn(),
    discoverDatabase: vi.fn(),
    serializeCampaignYaml: vi.fn(),
    serializeCampaignJson: vi.fn(),
  };
});

import {
  type Account,
  type Campaign,
  type CampaignAction,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  LauncherService,
  LinkedHelperNotRunningError,
  serializeCampaignJson,
  serializeCampaignYaml,
} from "@lhremote/core";

import { registerCampaignExport } from "./campaign-export.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_CAMPAIGN: Campaign = {
  id: 15,
  name: "Outreach Campaign",
  description: "Connect with engineering leaders",
  state: "active",
  liAccountId: 1,
  isPaused: true,
  isArchived: false,
  isValid: true,
  createdAt: "2026-02-07T10:00:00Z",
};

const MOCK_ACTIONS: CampaignAction[] = [
  {
    id: 86,
    campaignId: 15,
    name: "Visit Profile",
    description: null,
    config: {
      id: 100,
      actionType: "VisitAndExtract",
      actionSettings: { extractProfile: true },
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 1,
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

function mockCampaignRepo(
  campaign: Campaign = MOCK_CAMPAIGN,
  actions: CampaignAction[] = MOCK_ACTIONS,
) {
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getCampaign: vi.fn().mockReturnValue(campaign),
      getCampaignActions: vi.fn().mockReturnValue(actions),
    } as unknown as CampaignRepository;
  });
}

function setupSuccessPath() {
  mockLauncher();
  mockDb();
  mockCampaignRepo();
  vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
}

describe("registerCampaignExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-export", () => {
    const { server } = createMockServer();
    registerCampaignExport(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-export",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("exports campaign as YAML by default", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);
    setupSuccessPath();

    const yamlOutput = 'version: "1"\nname: Outreach Campaign\n';
    vi.mocked(serializeCampaignYaml).mockReturnValue(yamlOutput);

    const handler = getHandler("campaign-export");
    const result = await handler({ campaignId: 15, format: "yaml", cdpPort: 9222 });

    expect(serializeCampaignYaml).toHaveBeenCalledWith(MOCK_CAMPAIGN, MOCK_ACTIONS);
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { campaignId: 15, format: "yaml", config: yamlOutput },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("exports campaign as JSON when requested", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);
    setupSuccessPath();

    const jsonOutput = '{\n  "version": "1",\n  "name": "Outreach Campaign"\n}\n';
    vi.mocked(serializeCampaignJson).mockReturnValue(jsonOutput);

    const handler = getHandler("campaign-export");
    const result = await handler({ campaignId: 15, format: "json", cdpPort: 9222 });

    expect(serializeCampaignJson).toHaveBeenCalledWith(MOCK_CAMPAIGN, MOCK_ACTIONS);
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { campaignId: 15, format: "json", config: jsonOutput },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
        getCampaignActions: vi.fn(),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-export");
    const result = await handler({ campaignId: 999, format: "yaml", cdpPort: 9222 });

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

  it("returns error when connection fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-export");
    const result = await handler({ campaignId: 15, format: "yaml", cdpPort: 9222 });

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

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-export");
    const result = await handler({ campaignId: 15, format: "yaml", cdpPort: 9222 });

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

  it("closes database after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(serializeCampaignYaml).mockReturnValue("version: '1'\n");

    const handler = getHandler("campaign-export");
    await handler({ campaignId: 15, format: "yaml", cdpPort: 9222 });

    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("closes database after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignExport(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockImplementation(() => {
          throw new Error("db error");
        }),
        getCampaignActions: vi.fn(),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-export");
    await handler({ campaignId: 15, format: "yaml", cdpPort: 9222 });

    expect(dbClose).toHaveBeenCalledOnce();
  });
});
