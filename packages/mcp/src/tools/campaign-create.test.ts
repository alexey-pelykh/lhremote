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
    parseCampaignYaml: vi.fn(),
    parseCampaignJson: vi.fn(),
  };
});

import {
  type Account,
  type Campaign,
  CampaignExecutionError,
  CampaignFormatError,
  CampaignService,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  InstanceService,
  LauncherService,
  parseCampaignJson,
  parseCampaignYaml,
} from "@lhremote/core";

import { registerCampaignCreate } from "./campaign-create.js";
import { createMockServer } from "./testing/mock-server.js";

const YAML_CONFIG = `
version: "1"
name: Test Campaign
actions:
  - type: VisitAndExtract
`;

const JSON_CONFIG = JSON.stringify({
  version: "1",
  name: "Test Campaign",
  actions: [{ type: "VisitAndExtract" }],
});

const PARSED_CONFIG = {
  name: "Test Campaign",
  actions: [{ name: "VisitAndExtract", actionType: "VisitAndExtract" }],
};

const MOCK_CAMPAIGN: Campaign = {
  id: 42,
  name: "Test Campaign",
  description: null,
  state: "active",
  liAccountId: 1,
  isPaused: true,
  isArchived: false,
  isValid: true,
  createdAt: "2025-01-01T00:00:00.000Z",
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

function mockCampaignService(campaign: Campaign = MOCK_CAMPAIGN) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      create: vi.fn().mockResolvedValue(campaign),
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
  vi.mocked(parseCampaignYaml).mockReturnValue(PARSED_CONFIG);
  vi.mocked(parseCampaignJson).mockReturnValue(PARSED_CONFIG);
}

describe("registerCampaignCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-create", () => {
    const { server } = createMockServer();
    registerCampaignCreate(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-create",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully creates campaign from YAML config", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCreate(server);
    setupSuccessPath();

    const handler = getHandler("campaign-create");
    const result = await handler({
      config: YAML_CONFIG,
      format: "yaml",
      cdpPort: 9222,
    });

    expect(parseCampaignYaml).toHaveBeenCalledWith(YAML_CONFIG);
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_CAMPAIGN, null, 2),
        },
      ],
    });
  });

  it("successfully creates campaign from JSON config", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCreate(server);
    setupSuccessPath();

    const handler = getHandler("campaign-create");
    const result = await handler({
      config: JSON_CONFIG,
      format: "json",
      cdpPort: 9222,
    });

    expect(parseCampaignJson).toHaveBeenCalledWith(JSON_CONFIG);
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_CAMPAIGN, null, 2),
        },
      ],
    });
  });

  it("returns error for invalid YAML", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCreate(server);

    vi.mocked(parseCampaignYaml).mockImplementation(() => {
      throw new CampaignFormatError("Invalid YAML: unexpected token");
    });

    const handler = getHandler("campaign-create");
    const result = await handler({
      config: "%%%invalid",
      format: "yaml",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Invalid campaign configuration: Invalid YAML: unexpected token",
        },
      ],
    });
  });

  it("returns error for invalid JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCreate(server);

    vi.mocked(parseCampaignJson).mockImplementation(() => {
      throw new CampaignFormatError("Invalid JSON: unexpected token");
    });

    const handler = getHandler("campaign-create");
    const result = await handler({
      config: "{not-json",
      format: "json",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Invalid campaign configuration: Invalid JSON: unexpected token",
        },
      ],
    });
  });

  it("returns error when campaign creation fails", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCreate(server);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(parseCampaignYaml).mockReturnValue(PARSED_CONFIG);
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        create: vi
          .fn()
          .mockRejectedValue(
            new CampaignExecutionError("Failed to create campaign: UI error"),
          ),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-create");
    const result = await handler({
      config: YAML_CONFIG,
      format: "yaml",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to create campaign: Failed to create campaign: UI error",
        },
      ],
    });
  });

  it("disconnects instance and closes db after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCreate(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    mockCampaignService();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(parseCampaignYaml).mockReturnValue(PARSED_CONFIG);

    const handler = getHandler("campaign-create");
    await handler({ config: YAML_CONFIG, format: "yaml", cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("disconnects instance and closes db after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignCreate(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(parseCampaignYaml).mockReturnValue(PARSED_CONFIG);
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        create: vi.fn().mockRejectedValue(new Error("test error")),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-create");
    await handler({ config: YAML_CONFIG, format: "yaml", cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });
});
