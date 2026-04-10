// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../linkedin/dom-automation.js", () => ({
  humanizedScrollToByIndex: vi.fn().mockResolvedValue(undefined),
  retryInteraction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./get-feed.js", () => ({
  waitForFeedLoad: vi.fn().mockResolvedValue(undefined),
}));

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedScrollToByIndex, retryInteraction } from "../linkedin/dom-automation.js";
import { unfollowFromFeed } from "./unfollow-from-feed.js";

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn().mockResolvedValue(null),
  disconnect: vi.fn(),
};

function setupMocks(unfollowName: string | null = "John Doe") {
  vi.mocked(CDPClient).mockImplementation(function () {
    return mockClient as unknown as CDPClient;
  });
  vi.mocked(discoverTargets).mockResolvedValue([
    { id: "target-1", type: "page", title: "LinkedIn", url: "https://www.linkedin.com/feed/", description: "", devtoolsFrontendUrl: "" },
  ]);
  vi.mocked(humanizedScrollToByIndex).mockResolvedValue(undefined);

  // First evaluate: click menu button by index → returns true
  // Second evaluate: click "Unfollow {Name}" menu item → returns name
  mockClient.evaluate
    .mockResolvedValueOnce(true) // menu button clicked
    .mockResolvedValueOnce(unfollowName); // unfollow name from menu item
}

describe("unfollowFromFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      unfollowFromFeed({
        feedIndex: 0,
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("allows non-loopback host with allowRemote", async () => {
    setupMocks();

    const result = await unfollowFromFeed({
      feedIndex: 0,
      cdpPort: 9222,
      cdpHost: "192.168.1.100",
      allowRemote: true,
    });

    expect(result.success).toBe(true);
  });

  it("throws when no LinkedIn page is found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([
      { id: "target-1", type: "page", title: "Example", url: "https://example.com", description: "", devtoolsFrontendUrl: "" },
    ]);

    await expect(
      unfollowFromFeed({
        feedIndex: 0,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("navigates to the feed", async () => {
    setupMocks();

    await unfollowFromFeed({
      feedIndex: 0,
      cdpPort: 9222,
    });

    expect(mockClient.navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/",
    );
  });

  it("returns success with unfollowed name", async () => {
    setupMocks("Jane Smith");

    const result = await unfollowFromFeed({
      feedIndex: 0,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      feedIndex: 0,
      unfollowedName: "Jane Smith",
      dryRun: false,
    });
  });

  it("throws when no Unfollow menu item is found", async () => {
    setupMocks(null);

    // Third evaluate is the Escape dismiss
    mockClient.evaluate.mockResolvedValueOnce(undefined);

    await expect(
      unfollowFromFeed({
        feedIndex: 0,
        cdpPort: 9222,
      }),
    ).rejects.toThrow('No "Unfollow" item found');
  });

  it("wraps menu interaction in retryInteraction", async () => {
    setupMocks();

    await unfollowFromFeed({
      feedIndex: 0,
      cdpPort: 9222,
    });

    expect(retryInteraction).toHaveBeenCalledWith(expect.any(Function), 3);
  });

  it("scrolls menu button into view and clicks by index", async () => {
    setupMocks();

    await unfollowFromFeed({
      feedIndex: 0,
      cdpPort: 9222,
    });

    expect(humanizedScrollToByIndex).toHaveBeenCalledWith(
      mockClient,
      '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]',
      0,
      undefined,
    );
    // Menu button is clicked via evaluate (by index), not humanizedClick
    expect(mockClient.evaluate).toHaveBeenCalled();
  });

  it("disconnects the client even on error", async () => {
    setupMocks(null);

    // Third evaluate is the Escape dismiss
    mockClient.evaluate.mockResolvedValueOnce(undefined);

    await unfollowFromFeed({
      feedIndex: 0,
      cdpPort: 9222,
    }).catch(() => {});

    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});
