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
  humanizedScrollTo: vi.fn(),
  retryInteraction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
}));

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import {
  humanizedClick,
  humanizedHover,
  humanizedScrollTo,
  retryInteraction,
  waitForElement,
} from "../linkedin/dom-automation.js";
import { reactToComment } from "./react-to-comment.js";

const POST_URL = "https://www.linkedin.com/feed/update/urn:li:activity:7436698865522851840/";
const COMMENT_URN = "urn:li:comment:(activity:7436698865522851840,7436707959465730049)";
// The operation stamps a `data-comment-urn` marker onto the matching
// article and uses that for subsequent scoped queries (see operation
// implementation comment for rationale).  Tests assert against the
// marker-based selector.
const ARTICLE_SELECTOR = `article[data-comment-urn="${COMMENT_URN}"]`;
const TRIGGER_SELECTOR = `${ARTICLE_SELECTOR} button:is([aria-label^="React Like to "], [aria-label^="Unreact "])`;
const MENU_SELECTOR = `${ARTICLE_SELECTOR} button[aria-label="Open reactions menu"]`;

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn().mockResolvedValue(undefined),
  waitForEvent: vi.fn().mockResolvedValue(undefined),
};

/** Default trigger aria-label (no reaction applied). */
let nextTriggerLabel: string | null = null;

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
  vi.mocked(humanizedScrollTo).mockResolvedValue(undefined);

  // Conditional evaluate mock — the operation calls evaluate for several
  // distinct purposes:
  //   (a) `location.pathname`     — navigateAwayIf decision
  //   (b) JS-side comment-presence probe (load-more pagination loop)
  //   (c) reading the trigger button's `aria-label`
  // Defaulting to a no-op pathname avoids navigateAwayIf side effects.
  // The presence probe defaults to `true` so the pagination loop exits
  // on its first iteration without clicking "Load more comments" — tests
  // that exercise pagination can override per-call.
  // The trigger label is read from `nextTriggerLabel` (set per test).
  nextTriggerLabel = null;
  mockClient.evaluate.mockImplementation((script: unknown) => {
    if (typeof script === "string" && script.includes("location.pathname")) {
      return Promise.resolve("/feed/");
    }
    if (
      typeof script === "string" &&
      script.includes("article[data-id]") &&
      script.includes("setAttribute('data-comment-urn'")
    ) {
      return Promise.resolve(true);
    }
    if (typeof script === "string" && script.includes("getAttribute('aria-label')")) {
      return Promise.resolve(nextTriggerLabel);
    }
    return Promise.resolve(null);
  });
}

describe("reactToComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on invalid reaction type", async () => {
    await expect(
      reactToComment({
        postUrl: POST_URL,
        commentUrn: COMMENT_URN,
        reactionType: "angry" as never,
        cdpPort: 9222,
      }),
    ).rejects.toThrow('Invalid reaction type "angry"');
  });

  it("throws on invalid post URL", async () => {
    await expect(
      reactToComment({
        postUrl: "https://example.com/not-linkedin",
        commentUrn: COMMENT_URN,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("Invalid LinkedIn post URL");
  });

  it("throws on invalid comment URN", async () => {
    await expect(
      reactToComment({
        postUrl: POST_URL,
        commentUrn: "not-a-comment-urn",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("Invalid comment URN");
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      reactToComment({
        postUrl: POST_URL,
        commentUrn: COMMENT_URN,
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("allows non-loopback host with allowRemote", async () => {
    setupMocks();

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
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
      reactToComment({
        postUrl: POST_URL,
        commentUrn: COMMENT_URN,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("defaults reaction type to like", async () => {
    setupMocks();

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      cdpPort: 9222,
    });

    expect(result.reactionType).toBe("like");
    expect(result.alreadyReacted).toBe(false);
  });

  it("returns success with provided reaction type", async () => {
    setupMocks();

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "celebrate",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      success: true,
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "celebrate",
      alreadyReacted: false,
      currentReaction: null,
      dryRun: false,
    });
  });

  it('returns alreadyReacted when same reaction is active ("Unreact Like")', async () => {
    setupMocks();
    nextTriggerLabel = "Unreact Like";

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.reactionType).toBe("like");
    expect(result.alreadyReacted).toBe(true);
    expect(humanizedHover).not.toHaveBeenCalled();
  });

  it('returns alreadyReacted with comment-context aria-label ("Unreact Like to X\'s comment")', async () => {
    setupMocks();
    // Verifies the regex /^Unreact\s+(\w+)/i correctly handles the
    // comment-context-preserving form by capturing only the first word.
    nextTriggerLabel = "Unreact Like to Olly's comment";

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.alreadyReacted).toBe(true);
    expect(humanizedHover).not.toHaveBeenCalled();
  });

  it("unreacts first then re-Likes via direct trigger when target is Like", async () => {
    setupMocks();
    nextTriggerLabel = "Unreact Celebrate";

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.reactionType).toBe("like");
    expect(result.alreadyReacted).toBe(false);
    // For Like target: NO popup is needed — clicking the direct-Like
    // trigger is the apply mechanism.  2 clicks: (1) trigger to unreact
    // existing reaction, (2) trigger again to apply Like.
    expect(humanizedClick).toHaveBeenCalledTimes(2);
    expect(humanizedClick).toHaveBeenNthCalledWith(1, mockClient, TRIGGER_SELECTOR, undefined);
    expect(humanizedClick).toHaveBeenNthCalledWith(2, mockClient, TRIGGER_SELECTOR, undefined);
  });

  it("unreacts first then opens popup when target is non-Like", async () => {
    setupMocks();
    nextTriggerLabel = "Unreact Like";

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "celebrate",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.reactionType).toBe("celebrate");
    expect(result.alreadyReacted).toBe(false);
    // For non-Like target: 3 clicks: (1) trigger to unreact, (2) menu
    // to open popup, (3) popup-reaction button.
    expect(humanizedClick).toHaveBeenCalledTimes(3);
    expect(humanizedClick).toHaveBeenNthCalledWith(1, mockClient, TRIGGER_SELECTOR, undefined);
    expect(humanizedClick).toHaveBeenNthCalledWith(2, mockClient, MENU_SELECTOR, undefined);
    expect(humanizedClick).toHaveBeenNthCalledWith(
      3,
      mockClient,
      'button[aria-label^="React Celebrate to "]',
      undefined,
    );
  });

  it("returns dryRun: true for Like target — no clicks at all", async () => {
    setupMocks();

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.alreadyReacted).toBe(false);
    expect(result.currentReaction).toBeNull();
    // For Like target with dryRun: NO popup involved, NO clicks at all.
    expect(humanizedClick).not.toHaveBeenCalled();
  });

  it("returns dryRun: true for non-Like target — clicks menu but skips reaction", async () => {
    setupMocks();

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "insightful",
      cdpPort: 9222,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.alreadyReacted).toBe(false);
    expect(result.currentReaction).toBeNull();
    // For non-Like target with dryRun: clicks menu to validate popup opens,
    // but does NOT click the reaction button — exactly 1 click.
    expect(humanizedClick).toHaveBeenCalledTimes(1);
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, MENU_SELECTOR, undefined);
  });

  it("returns dryRun with currentReaction when a different reaction is active", async () => {
    setupMocks();
    nextTriggerLabel = "Unreact Celebrate";

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "love",
      cdpPort: 9222,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.alreadyReacted).toBe(false);
    expect(result.currentReaction).toBe("celebrate");
    // Should NOT click trigger to unreact (dryRun preserves state),
    // but DOES click menu to validate popup opens (non-Like target) —
    // exactly 1 click (no unreact, no reaction button).
    expect(humanizedClick).toHaveBeenCalledTimes(1);
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, MENU_SELECTOR, undefined);
  });

  it("returns alreadyReacted with dryRun when same reaction is active", async () => {
    setupMocks();
    nextTriggerLabel = "Unreact Like";

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
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

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      cdpPort: 9222,
    });

    expect(mockClient.navigate).toHaveBeenCalledWith(POST_URL);
  });

  it("scopes the trigger selector to the comment article", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      cdpPort: 9222,
    });

    // First waitForElement: anchor — any comment article (proves the
    // comments section has hydrated before we look for a specific URN).
    expect(waitForElement).toHaveBeenNthCalledWith(
      1,
      mockClient,
      "article.comments-comment-entity",
      undefined,
      undefined,
    );

    // Second waitForElement: the specific comment article
    expect(waitForElement).toHaveBeenNthCalledWith(
      2,
      mockClient,
      ARTICLE_SELECTOR,
      undefined,
      undefined,
    );

    // Third waitForElement: the comment-scoped reaction trigger
    expect(waitForElement).toHaveBeenNthCalledWith(
      3,
      mockClient,
      TRIGGER_SELECTOR,
      undefined,
      undefined,
    );
  });

  it("scrolls to the comment article", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      cdpPort: 9222,
    });

    expect(humanizedScrollTo).toHaveBeenCalledWith(
      mockClient,
      ARTICLE_SELECTOR,
      undefined,
    );
  });

  it("clicks the direct trigger (no popup) when target is Like", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
    });

    // Like target: just click the direct-Like trigger.  No menu.
    expect(humanizedClick).toHaveBeenCalledTimes(1);
    expect(humanizedClick).toHaveBeenCalledWith(
      mockClient,
      TRIGGER_SELECTOR,
      undefined,
    );
  });

  it("clicks Open-reactions-menu when target is non-Like", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "celebrate",
      cdpPort: 9222,
    });

    // Non-Like target: click menu to open popup.
    expect(humanizedClick).toHaveBeenCalledWith(
      mockClient,
      MENU_SELECTOR,
      undefined,
    );
  });

  it("wraps popup wait in retryInteraction (only fires for non-Like)", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "insightful",
      cdpPort: 9222,
    });

    expect(retryInteraction).toHaveBeenCalledWith(expect.any(Function), 3);

    // Final waitForElement: the comment-level popup reaction button
    // ("React {Type} to {Name}'s comment" prefix), with timeout, no mouse.
    expect(waitForElement).toHaveBeenLastCalledWith(
      mockClient,
      'button[aria-label^="React Insightful to "]',
      { timeout: 10_000 },
    );
  });

  it("clicks the correct popup-reaction selector for each non-Like type", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "funny",
      cdpPort: 9222,
    });

    expect(humanizedClick).toHaveBeenCalledWith(
      mockClient,
      'button[aria-label^="React Funny to "]',
      undefined,
    );
  });

  it("disconnects the CDP client even when an error occurs", async () => {
    setupMocks();
    vi.mocked(waitForElement).mockRejectedValueOnce(new Error("timeout"));

    await expect(
      reactToComment({
        postUrl: POST_URL,
        commentUrn: COMMENT_URN,
        cdpPort: 9222,
      }),
    ).rejects.toThrow("timeout");

    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it("uses default CDP host when not specified", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      cdpPort: 35000,
    });

    expect(discoverTargets).toHaveBeenCalledWith(35000, "127.0.0.1");
  });
});
