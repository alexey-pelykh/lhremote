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
  scrollFeed: vi.fn().mockResolvedValue(undefined),
}));

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { dismissFeedPost } from "./dismiss-feed-post.js";

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn().mockResolvedValue(null),
  disconnect: vi.fn(),
};

function setupMocks() {
  vi.mocked(CDPClient).mockImplementation(function () {
    return mockClient as unknown as CDPClient;
  });
  vi.mocked(discoverTargets).mockResolvedValue([
    { id: "target-1", type: "page", title: "LinkedIn", url: "https://www.linkedin.com/feed/", description: "", devtoolsFrontendUrl: "" },
  ]);
}

/**
 * Configure mockClient.evaluate to simulate a feed with one post whose
 * menu contains "Not interested".
 */
function setupFeedWithNotInterested() {
  mockClient.evaluate.mockImplementation((script: string) => {
    // Menu button click
    if (typeof script === "string" && script.includes("btn.click()")) {
      return Promise.resolve(true);
    }
    // "Not interested" click
    if (typeof script === "string" && script.includes("Not interested")) {
      return Promise.resolve(true);
    }
    // Escape key
    if (typeof script === "string" && script.includes("Escape")) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(null);
  });
}

describe("dismissFeedPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      dismissFeedPost({
        feedIndex: 0,
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("allows non-loopback host with allowRemote", async () => {
    setupMocks();
    setupFeedWithNotInterested();

    const result = await dismissFeedPost({
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
      dismissFeedPost({
        feedIndex: 0,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("returns success when post is found and dismissed", async () => {
    setupMocks();
    setupFeedWithNotInterested();

    const result = await dismissFeedPost({
      feedIndex: 0,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      feedIndex: 0,
      dryRun: false,
    });
  });

  it("throws when Not interested is not in the menu", async () => {
    setupMocks();
    mockClient.evaluate.mockImplementation((script: string) => {
      if (typeof script === "string" && script.includes("btn.click()")) return Promise.resolve(true);
      if (typeof script === "string" && script.includes("Not interested")) return Promise.resolve(false);
      if (typeof script === "string" && script.includes("Escape")) return Promise.resolve(undefined);
      return Promise.resolve(null);
    });

    await expect(
      dismissFeedPost({
        feedIndex: 0,
        cdpPort: 9222,
      }),
    ).rejects.toThrow('does not contain "Not interested"');
  });

  it("disconnects the CDP client even when an error occurs", async () => {
    setupMocks();
    mockClient.evaluate.mockRejectedValue(new Error("evaluation failed"));

    await expect(
      dismissFeedPost({
        feedIndex: 0,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("evaluation failed");

    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});
