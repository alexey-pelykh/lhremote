// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withInstanceDatabase: vi.fn(),
    CampaignService: vi.fn(),
    parseCampaignYaml: vi.fn(),
    parseCampaignJson: vi.fn(),
  };
});

import {
  type Campaign,
  CampaignExecutionError,
  CampaignFormatError,
  CampaignService,
  type InstanceDatabaseContext,
  parseCampaignJson,
  parseCampaignYaml,
  resolveAccount,
  withInstanceDatabase,
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

function mockCampaignService(campaign: Campaign = MOCK_CAMPAIGN) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      create: vi.fn().mockResolvedValue(campaign),
    } as unknown as CampaignService;
  });
}

function setupSuccessPath() {
  vi.mocked(resolveAccount).mockResolvedValue(1);
  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: {},
        db: {},
      } as unknown as InstanceDatabaseContext),
  );
  mockCampaignService();
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

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: {},
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
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
});
