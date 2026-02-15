// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    scrapeMessagingHistory: vi.fn(),
  };
});

import {
  type MessageStats,
  AccountResolutionError,
  scrapeMessagingHistory,
} from "@lhremote/core";

import { registerScrapeMessagingHistory } from "./scrape-messaging-history.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_STATS: MessageStats = {
  totalMessages: 2500,
  totalChats: 150,
  earliestMessage: "2024-01-15T09:00:00Z",
  latestMessage: "2025-01-15T12:00:00Z",
};

describe("registerScrapeMessagingHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named scrape-messaging-history", () => {
    const { server } = createMockServer();
    registerScrapeMessagingHistory(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "scrape-messaging-history",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns stats on success", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    vi.mocked(scrapeMessagingHistory).mockResolvedValue({
      success: true,
      actionType: "ScrapeMessagingHistory",
      stats: MOCK_STATS,
    });

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              actionType: "ScrapeMessagingHistory",
              stats: MOCK_STATS,
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
    registerScrapeMessagingHistory(server);

    vi.mocked(scrapeMessagingHistory).mockResolvedValue({
      success: true,
      actionType: "ScrapeMessagingHistory",
      stats: MOCK_STATS,
    });

    const handler = getHandler("scrape-messaging-history");
    await handler({ cdpPort: 9222 });

    expect(scrapeMessagingHistory).toHaveBeenCalledWith(
      expect.objectContaining({ cdpPort: 9222 }),
    );
  });

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    vi.mocked(scrapeMessagingHistory).mockRejectedValue(
      new AccountResolutionError("no-accounts"),
    );

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "No accounts found." }],
    });
  });

  it("returns error when multiple accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    vi.mocked(scrapeMessagingHistory).mockRejectedValue(
      new AccountResolutionError("multiple-accounts"),
    );

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Multiple accounts found. Cannot determine which instance to use.",
        },
      ],
    });
  });

  it("returns error on unexpected failure", async () => {
    const { server, getHandler } = createMockServer();
    registerScrapeMessagingHistory(server);

    vi.mocked(scrapeMessagingHistory).mockRejectedValue(
      new Error("action timed out"),
    );

    const handler = getHandler("scrape-messaging-history");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to scrape messaging history: action timed out",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerScrapeMessagingHistory,
    "scrape-messaging-history",
    () => ({ cdpPort: 9222 }),
    (error) => vi.mocked(scrapeMessagingHistory).mockRejectedValue(error),
    "Failed to scrape messaging history",
  );
});
