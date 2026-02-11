import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withDatabase: vi.fn(),
    CampaignRepository: vi.fn(),
  };
});

import {
  type CampaignAction,
  CampaignNotFoundError,
  CampaignRepository,
  type DatabaseContext,
  LinkedHelperNotRunningError,
  resolveAccount,
  withDatabase,
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
  vi.mocked(resolveAccount).mockResolvedValue(1);
  vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
    callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );
  mockCampaignRepo();
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

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockImplementation(async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
    );
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

    vi.mocked(resolveAccount).mockRejectedValue(
      new LinkedHelperNotRunningError(9222),
    );

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
});
