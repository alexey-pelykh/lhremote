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
  waitForElement: vi.fn(),
  humanizedClick: vi.fn(),
  humanizedScrollTo: vi.fn(),
  retryInteraction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
}));

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { waitForElement, humanizedClick, humanizedScrollTo, retryInteraction } from "../linkedin/dom-automation.js";
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
  vi.mocked(waitForElement).mockResolvedValue(undefined);
  vi.mocked(humanizedClick).mockResolvedValue(undefined);
  vi.mocked(humanizedScrollTo).mockResolvedValue(undefined);

  // The evaluate call inside retryInteraction finds the menu item
  mockClient.evaluate.mockResolvedValue(unfollowName);
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
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("allows non-loopback host with allowRemote", async () => {
    setupMocks();

    const result = await unfollowFromFeed({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
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
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("navigates to the post URL", async () => {
    setupMocks();

    await unfollowFromFeed({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(mockClient.navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    );
  });

  it("returns success with unfollowed name", async () => {
    setupMocks("Jane Smith");

    const result = await unfollowFromFeed({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      unfollowedName: "Jane Smith",
    });
  });

  it("throws when no Unfollow menu item is found", async () => {
    setupMocks(null);

    await expect(
      unfollowFromFeed({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
      }),
    ).rejects.toThrow('No "Unfollow" item found');
  });

  it("wraps menu interaction in retryInteraction", async () => {
    setupMocks();

    await unfollowFromFeed({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(retryInteraction).toHaveBeenCalledWith(expect.any(Function), 3);
  });

  it("scrolls to and clicks the menu button", async () => {
    setupMocks();

    await unfollowFromFeed({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    const selector = 'button[aria-label^="Open control menu for post"]';
    expect(humanizedScrollTo).toHaveBeenCalledWith(mockClient, selector, undefined);
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, selector, undefined);
  });

  it("disconnects the client even on error", async () => {
    setupMocks(null);

    await unfollowFromFeed({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    }).catch(() => {});

    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it("waits for the menu button before interacting", async () => {
    setupMocks();

    await unfollowFromFeed({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(waitForElement).toHaveBeenCalledWith(
      mockClient,
      'button[aria-label^="Open control menu for post"]',
      undefined,
      undefined,
    );
  });
});
