// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    collectPeople: vi.fn(),
  };
});

import {
  CollectionBusyError,
  CollectionError,
  collectPeople,
} from "@lhremote/core";

import { registerCollectPeople } from "./collect-people.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerCollectPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named collect-people", () => {
    const { server } = createMockServer();
    registerCollectPeople(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "collect-people",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns success result with detected source type", async () => {
    const { server, getHandler } = createMockServer();
    registerCollectPeople(server);

    vi.mocked(collectPeople).mockResolvedValue({
      success: true,
      campaignId: 42,
      sourceType: "SearchPage",
    });

    const handler = getHandler("collect-people");
    const result = await handler({
      campaignId: 42,
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              campaignId: 42,
              sourceType: "SearchPage",
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("passes all arguments to the operation", async () => {
    const { server, getHandler } = createMockServer();
    registerCollectPeople(server);

    vi.mocked(collectPeople).mockResolvedValue({
      success: true,
      campaignId: 42,
      sourceType: "SearchPage",
    });

    const handler = getHandler("collect-people");
    await handler({
      campaignId: 42,
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      limit: 100,
      maxPages: 5,
      pageSize: 25,
      sourceType: "SearchPage",
      cdpPort: 9222,
    });

    expect(collectPeople).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 42,
        sourceUrl: "https://www.linkedin.com/search/results/people/",
        limit: 100,
        maxPages: 5,
        pageSize: 25,
        sourceType: "SearchPage",
        cdpPort: 9222,
      }),
    );
  });

  it("returns error when instance is busy", async () => {
    const { server, getHandler } = createMockServer();
    registerCollectPeople(server);

    vi.mocked(collectPeople).mockRejectedValue(
      new CollectionBusyError("running"),
    );

    const handler = getHandler("collect-people");
    const result = await handler({
      campaignId: 42,
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Cannot collect — instance is busy (state: running)",
        },
      ],
    });
  });

  it("returns error for unrecognized source URL", async () => {
    const { server, getHandler } = createMockServer();
    registerCollectPeople(server);

    vi.mocked(collectPeople).mockRejectedValue(
      new CollectionError("Unrecognized source URL: https://www.linkedin.com/unknown/"),
    );

    const handler = getHandler("collect-people");
    const result = await handler({
      campaignId: 42,
      sourceUrl: "https://www.linkedin.com/unknown/",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Collection failed: Unrecognized source URL: https://www.linkedin.com/unknown/",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerCollectPeople,
    "collect-people",
    () => ({
      campaignId: 42,
      sourceUrl: "https://www.linkedin.com/search/results/people/",
      cdpPort: 9222,
    }),
    (error) => vi.mocked(collectPeople).mockRejectedValue(error),
    "Failed to collect people",
  );
});
