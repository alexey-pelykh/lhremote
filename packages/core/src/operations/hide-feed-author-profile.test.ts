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
import { hideFeedAuthorProfile } from "./hide-feed-author-profile.js";

const PROFILE_URL = "https://www.linkedin.com/in/jane-doe/";
const MORE_BUTTON_SELECTOR =
  'main button[aria-label="More actions"], main button[aria-label="More"]';

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

describe("hideFeedAuthorProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on an invalid profile URL before touching CDP", async () => {
    await expect(
      hideFeedAuthorProfile({
        profileUrl: "https://example.com/not-a-profile",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("Invalid LinkedIn profile URL");

    expect(discoverTargets).not.toHaveBeenCalled();
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      hideFeedAuthorProfile({
        profileUrl: PROFILE_URL,
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("requires --allow-remote");
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
      hideFeedAuthorProfile({ profileUrl: PROFILE_URL, cdpPort: 9222 }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("navigates to the profile before opening the More menu", async () => {
    setupMocks();
    mockClient.evaluate
      // Click More button → returns true
      .mockResolvedValueOnce(true)
      // Menu scan → returns mute item
      .mockResolvedValueOnce({ kind: "mute", name: "Jane Doe" })
      // Mute-confirmation dialog probe → no dialog present
      .mockResolvedValueOnce({ dialogPresent: false, confirmed: false })
      // Escape dismiss
      .mockResolvedValueOnce(undefined);

    await hideFeedAuthorProfile({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(navigateToProfile).toHaveBeenCalledWith(
      mockClient,
      "jane-doe",
      undefined,
    );
  });

  it("clicks Mute when available and returns success", async () => {
    setupMocks();
    mockClient.evaluate
      // Click More button → returns true
      .mockResolvedValueOnce(true)
      // Menu scan → returns mute item (click is executed inside the evaluate)
      .mockResolvedValueOnce({ kind: "mute", name: "Jane Doe" })
      // Mute-confirmation dialog probe → no dialog present
      .mockResolvedValueOnce({ dialogPresent: false, confirmed: false })
      // Escape dismiss
      .mockResolvedValueOnce(undefined);

    const result = await hideFeedAuthorProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      profileUrl: PROFILE_URL,
      publicId: "jane-doe",
      muted: true,
      hiddenName: "Jane Doe",
      dryRun: false,
    });
    expect(retryInteraction).toHaveBeenCalledWith(expect.any(Function), 3);
  });

  it("clicks the Mute confirmation dialog button when a two-step dialog appears", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ kind: "mute", name: "Jane Doe" })
      // Dialog found and confirm button clicked
      .mockResolvedValueOnce({ dialogPresent: true, confirmed: true })
      .mockResolvedValueOnce(undefined);

    const result = await hideFeedAuthorProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);

    // The confirmation-dialog probe evaluate script should reference the
    // confirm label patterns.
    const confirmCall = mockClient.evaluate.mock.calls.find((args) =>
      String(args[0]).includes('["Mute","Confirm"]')
    );
    expect(confirmCall).toBeDefined();
  });

  it("throws when confirmation dialog appears but no matching confirm button is clicked", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ kind: "mute", name: "Jane Doe" })
      // Dialog present but no matching confirm button — should throw
      // through retryInteraction, bubbling out of the retry wrapper
      // (which is mocked as pass-through).
      .mockResolvedValueOnce({ dialogPresent: true, confirmed: false });

    await expect(
      hideFeedAuthorProfile({ profileUrl: PROFILE_URL, cdpPort: 9222 }),
    ).rejects.toThrow(/Mute confirmation dialog appeared/);
  });

  it("returns success with muted=false when dryRun is true", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ kind: "mute", name: "Jane Doe" })
      .mockResolvedValueOnce(undefined);

    const result = await hideFeedAuthorProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
      dryRun: true,
    });

    expect(result).toEqual({
      success: true,
      profileUrl: PROFILE_URL,
      publicId: "jane-doe",
      muted: false,
      hiddenName: "Jane Doe",
      dryRun: true,
    });

    // In dryRun the mute-confirmation probe is skipped, so only three
    // evaluate calls happen: click More → menu scan → Escape dismiss.
    expect(mockClient.evaluate).toHaveBeenCalledTimes(3);
  });

  it("returns skip with reason=mute_not_available when neither Mute nor Unmute is present", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ kind: "none" })
      .mockResolvedValueOnce(undefined);

    const result = await hideFeedAuthorProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: false,
      profileUrl: PROFILE_URL,
      publicId: "jane-doe",
      muted: false,
      reason: "mute_not_available",
      dryRun: false,
    });
  });

  it("returns skip with reason=already_muted when Unmute is present", async () => {
    setupMocks();
    mockClient.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ kind: "unmute", name: "Jane Doe" })
      .mockResolvedValueOnce(undefined);

    const result = await hideFeedAuthorProfile({
      profileUrl: PROFILE_URL,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: false,
      profileUrl: PROFILE_URL,
      publicId: "jane-doe",
      muted: false,
      reason: "already_muted",
      dryRun: false,
    });
  });

  it("throws when the More button cannot be clicked", async () => {
    setupMocks();
    mockClient.evaluate.mockResolvedValueOnce(false);

    await expect(
      hideFeedAuthorProfile({ profileUrl: PROFILE_URL, cdpPort: 9222 }),
    ).rejects.toThrow(/Failed to open the profile More menu/);
  });

  it("disconnects the CDP client even when an error occurs", async () => {
    setupMocks();
    mockClient.evaluate.mockRejectedValue(new Error("evaluation failed"));

    await expect(
      hideFeedAuthorProfile({ profileUrl: PROFILE_URL, cdpPort: 9222 }),
    ).rejects.toThrow("evaluation failed");

    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it("uses the expected selector for the More button", () => {
    expect(MORE_BUTTON_SELECTOR).toBe(
      'main button[aria-label="More actions"], main button[aria-label="More"]',
    );
  });
});
