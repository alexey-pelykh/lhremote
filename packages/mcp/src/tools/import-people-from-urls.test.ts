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
  };
});

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  type InstanceDatabaseContext,
  LinkedHelperNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { registerImportPeopleFromUrls } from "./import-people-from-urls.js";
import { createMockServer } from "./testing/mock-server.js";

function mockCampaignService() {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      importPeopleFromUrls: vi.fn().mockResolvedValue({
        actionId: 85,
        successful: 2,
        alreadyInQueue: 0,
        alreadyProcessed: 0,
        failed: 0,
      }),
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
}

describe("registerImportPeopleFromUrls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named import-people-from-urls", () => {
    const { server } = createMockServer();
    registerImportPeopleFromUrls(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "import-people-from-urls",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("successfully imports people from URLs", async () => {
    const { server, getHandler } = createMockServer();
    registerImportPeopleFromUrls(server);
    setupSuccessPath();

    const handler = getHandler("import-people-from-urls");
    const result = await handler({
      campaignId: 14,
      linkedInUrls: [
        "https://www.linkedin.com/in/alice",
        "https://www.linkedin.com/in/bob",
      ],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              campaignId: 14,
              actionId: 85,
              imported: 2,
              alreadyInQueue: 0,
              alreadyProcessed: 0,
              failed: 0,
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
    registerImportPeopleFromUrls(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: {},
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        importPeopleFromUrls: vi
          .fn()
          .mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    const handler = getHandler("import-people-from-urls");
    const result = await handler({
      campaignId: 999,
      linkedInUrls: ["https://www.linkedin.com/in/alice"],
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
    registerImportPeopleFromUrls(server);

    vi.mocked(resolveAccount).mockRejectedValue(
      new LinkedHelperNotRunningError(9222),
    );

    const handler = getHandler("import-people-from-urls");
    const result = await handler({
      campaignId: 14,
      linkedInUrls: ["https://www.linkedin.com/in/alice"],
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

  it("returns error when campaign has no actions", async () => {
    const { server, getHandler } = createMockServer();
    registerImportPeopleFromUrls(server);

    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: {},
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        importPeopleFromUrls: vi
          .fn()
          .mockRejectedValue(
            new CampaignExecutionError(
              "Campaign 14 has no actions",
              14,
            ),
          ),
      } as unknown as CampaignService;
    });

    const handler = getHandler("import-people-from-urls");
    const result = await handler({
      campaignId: 14,
      linkedInUrls: ["https://www.linkedin.com/in/alice"],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to import people: Campaign 14 has no actions",
        },
      ],
    });
  });
});
