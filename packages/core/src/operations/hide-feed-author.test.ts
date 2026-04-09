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
  humanizedScrollToByIndex: vi.fn(),
  retryInteraction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
}));

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { waitForElement, humanizedClick, humanizedScrollToByIndex } from "../linkedin/dom-automation.js";
import { hideFeedAuthor } from "./hide-feed-author.js";

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn(),
  disconnect: vi.fn(),
};

function setupMocks(hiddenName: string | null = "John Doe") {
  vi.mocked(CDPClient).mockImplementation(function () {
    return mockClient as unknown as CDPClient;
  });
  vi.mocked(discoverTargets).mockResolvedValue([
    { id: "target-1", type: "page", title: "LinkedIn", url: "https://www.linkedin.com/feed/", description: "", devtoolsFrontendUrl: "" },
  ]);
  vi.mocked(waitForElement).mockResolvedValue(undefined);
  vi.mocked(humanizedClick).mockResolvedValue(undefined);
  vi.mocked(humanizedScrollToByIndex).mockResolvedValue(undefined);

  // First evaluate: find post index → returns 0
  // Second evaluate: click menu item → returns hidden name
  // Third evaluate (if name is null): dismiss menu via Escape
  mockClient.evaluate
    .mockResolvedValueOnce(0) // postIndex
    .mockResolvedValueOnce(hiddenName); // hidden name from menu item
}

describe("hideFeedAuthor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      hideFeedAuthor({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("allows non-loopback host with allowRemote", async () => {
    setupMocks();

    const result = await hideFeedAuthor({
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
      hideFeedAuthor({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("throws when no feed post menu button is found", async () => {
    vi.mocked(CDPClient).mockImplementation(function () {
      return mockClient as unknown as CDPClient;
    });
    vi.mocked(discoverTargets).mockResolvedValue([
      { id: "target-1", type: "page", title: "LinkedIn", url: "https://www.linkedin.com/feed/", description: "", devtoolsFrontendUrl: "" },
    ]);
    vi.mocked(waitForElement).mockResolvedValue(undefined);
    mockClient.evaluate.mockResolvedValueOnce(-1); // no menu buttons

    await expect(
      hideFeedAuthor({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("No feed post menu button found");
  });

  it("throws when 'Hide posts by' menu item is not found", async () => {
    setupMocks(null);

    // The third evaluate is the Escape dismiss
    mockClient.evaluate.mockResolvedValueOnce(undefined);

    await expect(
      hideFeedAuthor({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
      }),
    ).rejects.toThrow('No "Hide posts by" menu item found');
  });

  it("returns success with hidden name", async () => {
    setupMocks("Jane Smith");

    const result = await hideFeedAuthor({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      hiddenName: "Jane Smith",
    });
  });

  it("navigates to the post URL", async () => {
    setupMocks();

    await hideFeedAuthor({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(mockClient.navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    );
  });

  it("scrolls menu button into view and clicks it", async () => {
    setupMocks();

    await hideFeedAuthor({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(humanizedScrollToByIndex).toHaveBeenCalledWith(
      mockClient,
      '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]',
      0,
      undefined,
    );
    expect(humanizedClick).toHaveBeenCalledWith(
      mockClient,
      '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]',
      undefined,
    );
  });

  it("wraps menu interaction in retryInteraction", async () => {
    setupMocks();
    const { retryInteraction } = await import("../linkedin/dom-automation.js");

    await hideFeedAuthor({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(retryInteraction).toHaveBeenCalledWith(expect.any(Function), 3);
  });

  it("disconnects the CDP client even when an error occurs", async () => {
    setupMocks();
    vi.mocked(waitForElement).mockRejectedValueOnce(new Error("timeout"));

    await expect(
      hideFeedAuthor({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("timeout");

    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});
