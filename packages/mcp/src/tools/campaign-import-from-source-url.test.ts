// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    collectPeople: vi.fn(),
    withLoggedInStateRetryAtPort: vi.fn(
      async (
        _port: number | undefined,
        _host: string,
        _allowRemote: boolean,
        operation: () => Promise<unknown>,
      ) => operation(),
    ),
  };
});

import { collectPeople } from "@insoftex/lhremote-core";

import { registerCampaignImportFromSourceUrl } from "./campaign-import-from-source-url.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerCampaignImportFromSourceUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named campaign-import-from-source-url", () => {
    const { server } = createMockServer();
    registerCampaignImportFromSourceUrl(server);

    expect(server.tool).toHaveBeenCalledWith(
      "campaign-import-from-source-url",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("forwards source URL import arguments to collectPeople", async () => {
    const { server, getHandler } = createMockServer();
    registerCampaignImportFromSourceUrl(server);

    vi.mocked(collectPeople).mockResolvedValue({
      success: true,
      campaignId: 42,
      sourceType: "SearchPage",
    });

    const handler = getHandler("campaign-import-from-source-url");
    const result = await handler({
      campaignId: 42,
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      limit: 25,
      maxPages: 2,
      pageSize: 10,
      cdpPort: 9222,
    });

    expect(collectPeople).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: 42,
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      limit: 25,
      maxPages: 2,
      pageSize: 10,
      cdpPort: 9222,
    }));
    expect(result).toEqual({
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          campaignId: 42,
          sourceType: "SearchPage",
        }, null, 2),
      }],
    });
  });
});
