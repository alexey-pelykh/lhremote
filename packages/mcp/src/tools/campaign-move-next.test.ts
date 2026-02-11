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
  LauncherService,
  LinkedHelperNotRunningError,
  NoNextActionError,
} from "@lhremote/core";

import { registerCampaignMoveNext } from "./campaign-move-next.js";
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
  const moveToNextAction = vi.fn().mockReturnValue({ nextActionId: 6 });
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      moveToNextAction,
    } as unknown as CampaignRepository;
  });
  return { moveToNextAction };
}

function setupSuccessPath() {
  mockLauncher();
  mockDb();
  mockCampaignRepo();
  vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
}

describe("registerCampaignMoveNext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-move-next", () => {
    const { server } = createMockServer();
    registerCampaignMoveNext(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "campaign-move-next",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully moves persons to next action", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);
    setupSuccessPath();

    const handler = getHandler("campaign-move-next");
    const result = await handler({
      campaignId: 10,
      actionId: 5,
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
              fromActionId: 5,
              toActionId: 6,
              personsMoved: 2,
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("calls moveToNextAction with correct arguments", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);

    mockLauncher();
    mockDb();
    const { moveToNextAction } = mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-move-next");
    await handler({
      campaignId: 10,
      actionId: 5,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(moveToNextAction).toHaveBeenCalledWith(10, 5, [100, 200]);
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        moveToNextAction: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-move-next");
    const result = await handler({
      campaignId: 999,
      actionId: 5,
      personIds: [100],
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
    registerCampaignMoveNext(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        moveToNextAction: vi.fn().mockImplementation(() => {
          throw new ActionNotFoundError(999, 10);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-move-next");
    const result = await handler({
      campaignId: 10,
      actionId: 999,
      personIds: [100],
      cdpPort: 9222,
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

  it("returns error for last action in chain", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);

    mockLauncher();
    mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        moveToNextAction: vi.fn().mockImplementation(() => {
          throw new NoNextActionError(7, 10);
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-move-next");
    const result = await handler({
      campaignId: 10,
      actionId: 7,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Action 7 is the last action in campaign 10.",
        },
      ],
    });
  });

  it("returns error when LinkedHelper is not running", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("campaign-move-next");
    const result = await handler({
      campaignId: 10,
      actionId: 5,
      personIds: [100],
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
    registerCampaignMoveNext(server);

    mockLauncher();
    mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-move-next");
    await handler({
      campaignId: 10,
      actionId: 5,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(vi.mocked(DatabaseClient)).toHaveBeenCalledWith("/path/to/db", {
      readOnly: false,
    });
  });

  it("closes database after success", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    mockCampaignRepo();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("campaign-move-next");
    await handler({
      campaignId: 10,
      actionId: 5,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("closes database after error", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignMoveNext(server);

    mockLauncher();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        moveToNextAction: vi.fn().mockImplementation(() => {
          throw new Error("db error");
        }),
      } as unknown as CampaignRepository;
    });

    const handler = getHandler("campaign-move-next");
    await handler({
      campaignId: 10,
      actionId: 5,
      personIds: [100],
      cdpPort: 9222,
    });

    expect(dbClose).toHaveBeenCalledOnce();
  });
});
