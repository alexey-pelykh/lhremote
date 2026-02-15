// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    importPeopleFromUrls: vi.fn(),
  };
});

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  importPeopleFromUrls,
} from "@lhremote/core";

import { registerImportPeopleFromUrls } from "./import-people-from-urls.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

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

    vi.mocked(importPeopleFromUrls).mockResolvedValue({
      success: true,
      campaignId: 14,
      actionId: 85,
      imported: 2,
      alreadyInQueue: 0,
      alreadyProcessed: 0,
      failed: 0,
    });

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

  it("passes correct arguments to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerImportPeopleFromUrls(server);

    vi.mocked(importPeopleFromUrls).mockResolvedValue({
      success: true,
      campaignId: 14,
      actionId: 85,
      imported: 1,
      alreadyInQueue: 0,
      alreadyProcessed: 0,
      failed: 0,
    });

    const handler = getHandler("import-people-from-urls");
    await handler({
      campaignId: 14,
      linkedInUrls: ["https://www.linkedin.com/in/alice"],
      cdpPort: 9222,
    });

    expect(importPeopleFromUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 14,
        linkedInUrls: ["https://www.linkedin.com/in/alice"],
        cdpPort: 9222,
      }),
    );
  });

  it("returns error for non-existent campaign", async () => {
    const { server, getHandler } = createMockServer();
    registerImportPeopleFromUrls(server);

    vi.mocked(importPeopleFromUrls).mockRejectedValue(
      new CampaignNotFoundError(999),
    );

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

  it("returns error when campaign has no actions", async () => {
    const { server, getHandler } = createMockServer();
    registerImportPeopleFromUrls(server);

    vi.mocked(importPeopleFromUrls).mockRejectedValue(
      new CampaignExecutionError(
        "Campaign 14 has no actions",
        14,
      ),
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
          text: "Failed to import people: Campaign 14 has no actions",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerImportPeopleFromUrls,
    "import-people-from-urls",
    () => ({
      campaignId: 14,
      linkedInUrls: ["https://www.linkedin.com/in/alice"],
      cdpPort: 9222,
    }),
    (error) => vi.mocked(importPeopleFromUrls).mockRejectedValue(error),
    "Failed to import people",
  );
});
