// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

// The budget pre-flight resolves an account and opens a database.  These three
// are mocked for the same reason `comment-on-post.test.ts` mocks them: left
// real, `resolveAccount` reaches `LauncherService`, which builds its own
// `CDPClient` — the module-mocked one, shared with this file — and consumes
// the `mockResolvedValueOnce` queue that `detectCurrentReaction` is waiting on.
vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  ActionBudgetRepository: vi.fn(),
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

vi.mock("./wait-for-logged-in-state.js", () => ({
  gateOnLoggedInState: vi.fn().mockResolvedValue(undefined),
  waitForLoggedInState: vi.fn().mockResolvedValue(undefined),
  LoggedInStateTimeoutError: class extends Error {},
}));

import { gateOnLoggedInState } from "./wait-for-logged-in-state.js";

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { ActionBudgetRepository } from "../db/index.js";
import { waitForElement, humanizedHover, humanizedClick, retryInteraction } from "../linkedin/dom-automation.js";
import { resolveAccount } from "../services/account-resolution.js";
import { BudgetExceededError } from "../services/errors.js";
import type { DatabaseContext } from "../services/instance-context.js";
import { withDatabase } from "../services/instance-context.js";
import type { ActionBudgetEntry } from "../types/action-budget.js";
import { reactToPost, REACTION_TYPES } from "./react-to-post.js";

/** A PostLike budget entry with ample headroom — the default for every test. */
const POST_LIKE_BUDGET: ActionBudgetEntry = {
  limitTypeId: 18,
  limitType: "PostLike",
  dailyLimit: 100,
  campaignUsed: 4,
  directUsed: 0,
  totalUsed: 4,
  remaining: 96,
};

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn().mockResolvedValue(null),
  disconnect: vi.fn(),
};

function setupMocks(budgetEntries: ActionBudgetEntry[] = [POST_LIKE_BUDGET]) {
  vi.mocked(resolveAccount).mockResolvedValue(1);
  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );
  vi.mocked(ActionBudgetRepository).mockImplementation(function () {
    return {
      getActionBudget: vi.fn().mockReturnValue(budgetEntries),
      getLimitTypes: vi.fn().mockReturnValue([]),
    } as unknown as ActionBudgetRepository;
  });

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
    expect(vi.mocked(gateOnLoggedInState)).toHaveBeenCalled();
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

  describe("action budget", () => {
    const POST_URL = "https://www.linkedin.com/feed/update/urn:li:activity:123/";

    /** The same entry, exhausted. */
    const EXHAUSTED: ActionBudgetEntry = {
      ...POST_LIKE_BUDGET,
      campaignUsed: 100,
      totalUsed: 100,
      remaining: 0,
    };

    it("throws BudgetExceededError when the PostLike limit is reached", async () => {
      setupMocks([EXHAUSTED]);

      await expect(
        reactToPost({ postUrl: POST_URL, cdpPort: 9222 }),
      ).rejects.toThrow(BudgetExceededError);
    });

    it("names PostLike in the refusal, not some other exhausted limit", async () => {
      setupMocks([EXHAUSTED]);

      await expect(
        reactToPost({ postUrl: POST_URL, cdpPort: 9222 }),
      ).rejects.toThrow(/PostLike/);
    });

    it("refuses before touching the network or the DOM", async () => {
      // The point of checking up front: an exhausted budget must not cost a
      // target discovery, a CDP connection, or a navigation. Asserting the
      // rejection alone would pass even if the check ran last.
      setupMocks([EXHAUSTED]);

      await expect(
        reactToPost({ postUrl: POST_URL, cdpPort: 9222 }),
      ).rejects.toThrow(BudgetExceededError);

      expect(discoverTargets).not.toHaveBeenCalled();
      expect(mockClient.connect).not.toHaveBeenCalled();
      expect(mockClient.navigate).not.toHaveBeenCalled();
      expect(waitForElement).not.toHaveBeenCalled();
    });

    it("consults limit type 18, not whichever entry happens to be exhausted", async () => {
      // 18 is the operation's own identity and the one thing it does not share
      // with `comment-on-post`. An exhausted PostComment beside a healthy
      // PostLike is the case that separates "checks its budget" from "checks
      // a budget".
      setupMocks([
        POST_LIKE_BUDGET,
        {
          limitTypeId: 19,
          limitType: "PostComment",
          dailyLimit: 10,
          campaignUsed: 10,
          directUsed: 0,
          totalUsed: 10,
          remaining: 0,
        },
      ]);

      const result = await reactToPost({ postUrl: POST_URL, cdpPort: 9222 });

      expect(result.success).toBe(true);
    });

    it("refuses a dry run too, on the same exhausted budget", async () => {
      // Deliberate, and mirrors `comment-on-post`: the check runs ahead of the
      // dry-run branch. A dry run answers "what would happen", and with the
      // budget gone what would happen is this refusal.
      setupMocks([EXHAUSTED]);

      await expect(
        reactToPost({ postUrl: POST_URL, cdpPort: 9222, dryRun: true }),
      ).rejects.toThrow(BudgetExceededError);
    });

    it("proceeds when PostLike has no daily limit configured", async () => {
      setupMocks([
        {
          ...POST_LIKE_BUDGET,
          dailyLimit: null,
          campaignUsed: 0,
          totalUsed: 0,
          remaining: null,
        },
      ]);

      const result = await reactToPost({ postUrl: POST_URL, cdpPort: 9222 });

      expect(result.success).toBe(true);
    });

    it("proceeds when PostLike is absent from the budget entirely", async () => {
      setupMocks([
        {
          limitTypeId: 8,
          limitType: "Invite",
          dailyLimit: 100,
          campaignUsed: 5,
          directUsed: 0,
          totalUsed: 5,
          remaining: 95,
        },
      ]);

      const result = await reactToPost({ postUrl: POST_URL, cdpPort: 9222 });

      expect(result.success).toBe(true);
    });

    it("resolves the account with the port and connection options it was given", async () => {
      setupMocks();

      await reactToPost({
        postUrl: POST_URL,
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
        allowRemote: true,
        accountId: 42,
      });

      expect(resolveAccount).toHaveBeenCalledWith(9222, {
        host: "192.168.1.100",
        allowRemote: true,
        accountId: 42,
      });
    });
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
