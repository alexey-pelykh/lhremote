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

import { registerCampaignDelete } from "./campaign-delete.js";
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

function mockCampaignService(overrides: Record<string, unknown> = {}) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      delete: vi.fn().mockResolvedValue(undefined),
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

describe("registerCampaignDelete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-delete", () => {
    const { server } = createMockServer();
    registerCampaignDelete(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-delete",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully deletes a campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignDelete(server);
    setupSuccessPath();

    const handler = getHandler("campaign-delete");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: true, campaignId: 15, action: "archived" },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignDelete(server);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        delete: vi.fn().mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-delete");
    const result = await handler({
      campaignId: 999,
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
    registerCampaignDelete(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-delete");
    const result = await handler({
      campaignId: 15,
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
    registerCampaignDelete(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-delete");
    const result = await handler({
      campaignId: 15,
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
    registerCampaignDelete(server);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        delete: vi
          .fn()
          .mockRejectedValue(
            new CampaignExecutionError(
              "Failed to delete campaign 15: UI error",
              15,
            ),
          ),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-delete");
    const result = await handler({
      campaignId: 15,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to delete campaign: Failed to delete campaign 15: UI error",
        },
      ],
    });
  });

  it("disconnects instance and closes db after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignDelete(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    mockCampaignService();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-delete");
    await handler({ campaignId: 15, archive: true, cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("disconnects instance and closes db after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignDelete(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        delete: vi.fn().mockRejectedValue(new Error("test error")),
      } as unknown as CampaignService;
    });

    const handler = getHandler("campaign-delete");
    await handler({ campaignId: 15, archive: true, cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });
});
