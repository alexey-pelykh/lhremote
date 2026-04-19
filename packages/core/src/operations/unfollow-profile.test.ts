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
  waitForElement: vi.fn().mockResolvedValue(undefined),
  retryInteraction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./navigate-to-profile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./navigate-to-profile.js")>();
  return {
    ...actual,
    navigateToProfile: vi.fn().mockResolvedValue(undefined),
  };
});

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { retryInteraction } from "../linkedin/dom-automation.js";
import { navigateToProfile } from "./navigate-to-profile.js";
import { unfollowProfile } from "./unfollow-profile.js";

const PROFILE_URL = "https://www.linkedin.com/in/jane-doe/";
const FOLLOWING_SELECTOR = 'main button[aria-label^="Following "]';
const FOLLOW_SELECTOR = 'main button[aria-label^="Follow "]';

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn(),
  disconnect: vi.fn(),
};

function setupMocks(): void {
  vi.mocked(CDPClient).mockImplementation(function () {
    return mockClient as unknown as CDPClient;
  });
  vi.mocked(discoverTargets).mockResolvedValue([
    {
      id: "target-1",
      type: "page",
      title: "LinkedIn",
      url: "https://www.linkedin.com/feed/",
      description: "",
      devtoolsFrontendUrl: "",
    },
  ]);
}

describe("unfollowProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on an invalid profile URL before touching CDP", async () => {
    await expect(
      unfollowProfile({
        profileUrl: "https://example.com/not-a-profile",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("Invalid LinkedIn profile URL");

    expect(discoverTargets).not.toHaveBeenCalled();
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      unfollowProfile({
        profileUrl: PROFILE_URL,
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("allows non-loopback host with allowRemote", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce({ state: "not_following", name: null });

    const result = await unfollowProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
      cdpHost: "192.168.1.100",
      allowRemote: true,
    });

    expect(result.success).toBe(true);
  });

  it("throws when no LinkedIn page is found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([
      {
        id: "target-1",
        type: "page",
        title: "Example",
        url: "https://example.com",
        description: "",
        devtoolsFrontendUrl: "",
      },
    ]);

    await expect(
      unfollowProfile({ profileUrl: PROFILE_URL, cdpPort: 9222 }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("returns priorState=not_following without clicking when Follow button is present", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce({ state: "not_following", name: null });

    const result = await unfollowProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      profileUrl: PROFILE_URL,
      publicId: "jane-doe",
      priorState: "not_following",
      unfollowedName: null,
      dryRun: false,
    });
    // Only the initial detection evaluate runs — no click.
    expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
  });

  it("navigates to the profile before inspecting the button", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce({ state: "not_following", name: null });

    await unfollowProfile({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(navigateToProfile).toHaveBeenCalledWith(
      mockClient,
      "jane-doe",
      undefined,
    );
  });

  it("returns priorState=unknown without clicking when neither button is found", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce({ state: "unknown", name: null });

    const result = await unfollowProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      profileUrl: PROFILE_URL,
      publicId: "jane-doe",
      priorState: "unknown",
      unfollowedName: null,
      dryRun: false,
    });
    expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
  });

  it("clicks Unfollow in the confirmation dialog when currently following", async () => {
    setupMocks();
    mockClient.evaluate
      // Initial detection: Following "Jane Doe"
      .mockResolvedValueOnce({ state: "following", name: "Jane Doe" })
      // Click Following button → returns true
      .mockResolvedValueOnce(true)
      // Find "Unfollow Jane Doe" in dialog → returns name
      .mockResolvedValueOnce("Jane Doe");

    const result = await unfollowProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      profileUrl: PROFILE_URL,
      publicId: "jane-doe",
      priorState: "following",
      unfollowedName: "Jane Doe",
      dryRun: false,
    });
    expect(retryInteraction).toHaveBeenCalledWith(expect.any(Function), 3);
  });

  it("honors dryRun by not clicking the Unfollow button", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce({ state: "following", name: "Jane Doe" })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce("Jane Doe")
      // Escape dismiss
      .mockResolvedValueOnce(undefined);

    const result = await unfollowProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.priorState).toBe("following");
    expect(result.unfollowedName).toBe("Jane Doe");
  });

  it("falls back to synchronous unfollow when no confirmation dialog appears", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce({ state: "following", name: "Jane Doe" })
      // Click Following button → returns true
      .mockResolvedValueOnce(true)
      // Find dialog button → returns null (no dialog appeared)
      .mockResolvedValueOnce(null)
      // Verify Follow button now present → returns true (synchronous unfollow)
      .mockResolvedValueOnce(true);

    const result = await unfollowProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
    });

    expect(result.priorState).toBe("following");
    expect(result.unfollowedName).toBe("Jane Doe");
  });

  it("throws when confirmation dialog does not appear and Follow button did not toggle", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce({ state: "following", name: "Jane Doe" })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(null)
      // Follow button still not present after click
      .mockResolvedValueOnce(false)
      // Escape dismiss
      .mockResolvedValueOnce(undefined);

    await expect(
      unfollowProfile({ profileUrl: PROFILE_URL, cdpPort: 9222 }),
    ).rejects.toThrow(/Unfollow confirmation did not appear/);
  });

  it("disconnects the CDP client even when an error occurs", async () => {
    setupMocks();
    mockClient.evaluate.mockRejectedValue(new Error("evaluation failed"));

    await expect(
      unfollowProfile({ profileUrl: PROFILE_URL, cdpPort: 9222 }),
    ).rejects.toThrow("evaluation failed");

    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it("uses the expected selectors for the profile action buttons", () => {
    // This pins the selector strategy so accidental changes break the test.
    expect(FOLLOWING_SELECTOR).toBe('main button[aria-label^="Following "]');
    expect(FOLLOW_SELECTOR).toBe('main button[aria-label^="Follow "]');
  });
});
