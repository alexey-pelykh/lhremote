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
  waitForDOMStable: vi.fn().mockResolvedValue(undefined),
  hover: vi.fn(),
  click: vi.fn(),
  humanizedHover: vi.fn(),
  humanizedClick: vi.fn(),
  retryInteraction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
}));

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { waitForElement, humanizedHover, humanizedClick, retryInteraction } from "../linkedin/dom-automation.js";
import { reactToPost, REACTION_TYPES } from "./react-to-post.js";

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
  vi.mocked(waitForElement).mockResolvedValue(undefined);
  vi.mocked(humanizedHover).mockResolvedValue(undefined);
  vi.mocked(humanizedClick).mockResolvedValue(undefined);
}

describe("reactToPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on invalid reaction type", async () => {
    await expect(
      reactToPost({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        reactionType: "angry" as never,
        cdpPort: 9222,
      }),
    ).rejects.toThrow('Invalid reaction type "angry"');
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      reactToPost({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("allows non-loopback host with allowRemote", async () => {
    setupMocks();

    const result = await reactToPost({
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
      reactToPost({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("defaults reaction type to like", async () => {
    setupMocks();

    const result = await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(result.reactionType).toBe("like");
    expect(result.alreadyReacted).toBe(false);
  });

  it("returns success with provided reaction type", async () => {
    setupMocks();

    const result = await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "celebrate",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "celebrate",
      alreadyReacted: false,
      currentReaction: null,
      dryRun: false,
    });
  });

  it("returns alreadyReacted when same reaction is active (post page)", async () => {
    setupMocks();
    // Simulate post page: trigger has "Unreact Like" aria-label
    mockClient.evaluate.mockResolvedValueOnce("Unreact Like");

    const result = await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "like",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.reactionType).toBe("like");
    expect(result.alreadyReacted).toBe(true);
    // Should NOT hover or click reaction buttons
    expect(humanizedHover).not.toHaveBeenCalled();
  });

  it("returns alreadyReacted when same reaction is active (feed page)", async () => {
    setupMocks();
    // Simulate feed page: trigger has "Reaction button state: Like"
    mockClient.evaluate.mockResolvedValueOnce("Reaction button state: Like");

    const result = await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "like",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.alreadyReacted).toBe(true);
    expect(humanizedHover).not.toHaveBeenCalled();
  });

  it("unreacts first when a different reaction is active", async () => {
    setupMocks();
    // Simulate post page: trigger has "Unreact Celebrate"
    mockClient.evaluate.mockResolvedValueOnce("Unreact Celebrate");

    const result = await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "like",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.reactionType).toBe("like");
    expect(result.alreadyReacted).toBe(false);
    // Should click trigger to unreact, then hover to open popup
    expect(humanizedClick).toHaveBeenCalledTimes(2);
    expect(humanizedHover).toHaveBeenCalled();
  });

  it("returns dryRun: true and hovers popup but skips click", async () => {
    setupMocks();

    const result = await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "like",
      cdpPort: 9222,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.alreadyReacted).toBe(false);
    expect(result.currentReaction).toBeNull();
    // Should hover to validate popup opens, but NOT click
    expect(humanizedHover).toHaveBeenCalled();
    expect(humanizedClick).not.toHaveBeenCalled();
  });

  it("returns dryRun with currentReaction when a different reaction is active", async () => {
    setupMocks();
    mockClient.evaluate.mockResolvedValueOnce("Unreact Celebrate");

    const result = await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "like",
      cdpPort: 9222,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.alreadyReacted).toBe(false);
    expect(result.currentReaction).toBe("celebrate");
    // Should NOT click to unreact, but should hover to validate popup
    expect(humanizedClick).not.toHaveBeenCalled();
    expect(humanizedHover).toHaveBeenCalled();
  });

  it("returns alreadyReacted with dryRun when same reaction is active", async () => {
    setupMocks();
    mockClient.evaluate.mockResolvedValueOnce("Unreact Like");

    const result = await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "like",
      cdpPort: 9222,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.alreadyReacted).toBe(true);
    expect(result.currentReaction).toBe("like");
  });

  it("navigates to the post URL", async () => {
    setupMocks();

    await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(mockClient.navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    );
  });

  it("hovers the reaction trigger to expand the menu", async () => {
    setupMocks();

    await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(humanizedHover).toHaveBeenCalledWith(
      mockClient,
      'button[aria-label^="Reaction button state"], button.react-button__trigger',
      undefined,
    );
  });

  it("wraps popup wait in retryInteraction without mouse to prevent drift", async () => {
    setupMocks();

    await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "insightful",
      cdpPort: 9222,
    });

    // retryInteraction should be called to wrap the hover+wait sequence
    expect(retryInteraction).toHaveBeenCalledWith(expect.any(Function), 3);

    // waitForElement should be called with timeout 10_000 and WITHOUT mouse
    expect(waitForElement).toHaveBeenCalledWith(
      mockClient,
      'button[aria-label="Insightful"], button[aria-label="React Insightful"]',
      { timeout: 10_000 },
    );
  });

  it("clicks the correct reaction selector for each type", async () => {
    setupMocks();

    await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      reactionType: "funny",
      cdpPort: 9222,
    });

    expect(humanizedClick).toHaveBeenCalledWith(
      mockClient,
      'button[aria-label="Funny"], button[aria-label="React Funny"]',
      undefined,
    );
  });

  it("disconnects the CDP client even when an error occurs", async () => {
    setupMocks();
    vi.mocked(waitForElement).mockRejectedValueOnce(new Error("timeout"));

    await expect(
      reactToPost({
        postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("timeout");

    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it("uses default CDP port when not specified", async () => {
    setupMocks();

    await reactToPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 35000,
    });

    expect(discoverTargets).toHaveBeenCalledWith(35000, "127.0.0.1");
  });
});

describe("REACTION_TYPES", () => {
  it("contains all six reaction types", () => {
    expect(REACTION_TYPES).toEqual([
      "like",
      "celebrate",
      "support",
      "love",
      "insightful",
      "funny",
    ]);
  });
});
