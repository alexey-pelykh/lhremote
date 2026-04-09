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

const TARGET_URL = "https://www.linkedin.com/feed/update/urn:li:activity:123/";

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
 * Configure mockClient.evaluate to simulate a feed with one post whose URL
 * matches `targetUrl`, and whose menu contains "Not interested".
 */
function setupFeedWithPost(targetUrl: string) {
  mockClient.evaluate.mockImplementation((script: string) => {
    // Clipboard interceptor install
    if (typeof script === "string" && script.includes("__capturedClipboard")) {
      if (script.includes("writeText")) return Promise.resolve(undefined);
      if (script.includes("= null")) return Promise.resolve(undefined);
      // Read captured clipboard
      return Promise.resolve(targetUrl);
    }
    // Post count query
    if (typeof script === "string" && script.includes(".length")) {
      return Promise.resolve(1);
    }
    // Menu button click
    if (typeof script === "string" && script.includes("btn.click()")) {
      return Promise.resolve(true);
    }
    // "Copy link to post" click
    if (typeof script === "string" && script.includes("Copy link to post")) {
      return Promise.resolve(undefined);
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
        postUrl: TARGET_URL,
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("allows non-loopback host with allowRemote", async () => {
    setupMocks();
    setupFeedWithPost(TARGET_URL);

    const result = await dismissFeedPost({
      postUrl: TARGET_URL,
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
        postUrl: TARGET_URL,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("returns success when post is found and dismissed", async () => {
    setupMocks();
    setupFeedWithPost(TARGET_URL);

    const result = await dismissFeedPost({
      postUrl: TARGET_URL,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      postUrl: TARGET_URL,
    });
  });

  it("throws when Not interested is not in the menu", async () => {
    setupMocks();
    mockClient.evaluate.mockImplementation((script: string) => {
      if (typeof script === "string" && script.includes("writeText")) return Promise.resolve(undefined);
      if (typeof script === "string" && script.includes("= null")) return Promise.resolve(undefined);
      if (typeof script === "string" && script.includes("__capturedClipboard") && !script.includes("=")) return Promise.resolve(TARGET_URL);
      if (typeof script === "string" && script.includes(".length")) return Promise.resolve(1);
      if (typeof script === "string" && script.includes("btn.click()")) return Promise.resolve(true);
      if (typeof script === "string" && script.includes("Copy link to post")) return Promise.resolve(undefined);
      if (typeof script === "string" && script.includes("Not interested")) return Promise.resolve(false);
      if (typeof script === "string" && script.includes("Escape")) return Promise.resolve(undefined);
      return Promise.resolve(null);
    });

    await expect(
      dismissFeedPost({
        postUrl: TARGET_URL,
        cdpPort: 9222,
      }),
    ).rejects.toThrow('does not contain "Not interested"');
  });

  it("throws when post is not found in the feed", async () => {
    setupMocks();
    // Simulate an empty feed (0 posts)
    mockClient.evaluate.mockImplementation((script: string) => {
      if (typeof script === "string" && script.includes("writeText")) return Promise.resolve(undefined);
      if (typeof script === "string" && script.includes(".length")) return Promise.resolve(0);
      return Promise.resolve(null);
    });

    await expect(
      dismissFeedPost({
        postUrl: TARGET_URL,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("Post not found in the feed");
  });

  it("disconnects the CDP client even when an error occurs", async () => {
    setupMocks();
    mockClient.evaluate.mockRejectedValue(new Error("evaluation failed"));

    await expect(
      dismissFeedPost({
        postUrl: TARGET_URL,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("evaluation failed");

    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});
