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
  click: vi.fn().mockResolvedValue(undefined),
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
  click,
  humanizedClick,
  humanizedHover,
  humanizedScrollTo,
  retryInteraction,
  waitForElement,
} from "../linkedin/dom-automation.js";
import { reactToComment } from "./react-to-comment.js";

const POST_URL = "https://www.linkedin.com/feed/update/urn:li:activity:7436698865522851840/";
const COMMENT_URN = "urn:li:comment:(activity:7436698865522851840,7436707959465730049)";
// The operation normalizes `commentUrn` to the React/SDUI form
// (`urn:li:comment:(urn:li:activity:N,M)`) and scopes selectors to a
// `componentkey="replaceableComment_<URN>"` element.  Tests assert
// against the normalized componentkey selector.  See lhremote#776.
const NORMALIZED_COMMENT_URN = "urn:li:comment:(urn:li:activity:7436698865522851840,7436707959465730049)";
const ARTICLE_SELECTOR = `[componentkey="replaceableComment_${NORMALIZED_COMMENT_URN}"]`;
const MENU_SELECTOR = `${ARTICLE_SELECTOR} button[aria-label="Open reactions menu"]`;

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn().mockResolvedValue(undefined),
  waitForEvent: vi.fn().mockResolvedValue(undefined),
};

/** Default reaction-state textContent (null → operation reads as not-reacted). */
let nextReactionStateText: string | null = null;

/**
 * Helper: build the React/SDUI state-text for a given reaction type.
 * Produces the doubled-word form the parser expects (e.g. "InsightfulInsightful").
 * Pass `null` for the not-reacted state.
 */
function reactionStateText(name: string | null): string {
  if (name === null) {
    // "no reactionLike" — visible "Like" prompt is appended to the hidden
    // a11y "no reaction" label.
    return "Reaction button state: no reactionLike";
  }
  // "InsightfulInsightful" — hidden a11y label + visible button face.
  return `Reaction button state: ${name}${name}`;
}

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
  //   (b) JS-side comment-presence probe (load-more pagination loop) —
  //       SDUI stack uses `componentkey="replaceableComment_<URN>"`.
  //   (c) reading the comment's reaction state via the `[role="button"]`
  //       text content (`Reaction button state: <X>`).
  // Defaulting to a no-op pathname avoids navigateAwayIf side effects.
  // The presence probe defaults to `true` so the pagination loop exits
  // on its first iteration without clicking "Load more comments" — tests
  // that exercise pagination can override per-call.
  // The current reaction is set per test via `nextReactionStateText`
  // (e.g. "Reaction button state: InsightfulInsightful" → Insightful;
  //       "Reaction button state: no reactionLike" → not reacted).
  nextReactionStateText = null;
  mockClient.evaluate.mockImplementation((script: unknown) => {
    if (typeof script === "string" && script.includes("location.pathname")) {
      return Promise.resolve("/feed/");
    }
    // State-text read MUST be matched before the componentkey-presence
    // check below — the state-detection script also contains
    // `componentkey=` (in the JSON-stringified scope selector), so the
    // order matters.
    if (
      typeof script === "string" &&
      script.includes("Reaction button state:")
    ) {
      return Promise.resolve(nextReactionStateText);
    }
    if (
      typeof script === "string" &&
      script.includes("componentkey=") &&
      script.includes("replaceableComment_")
    ) {
      return Promise.resolve(true);
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

  it("returns alreadyReacted when same reaction is active (state-text 'LikeLike')", async () => {
    setupMocks();
    nextReactionStateText = reactionStateText("Like");

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
    // No menu click happens — the no-op short-circuits before the popup.
    expect(humanizedClick).not.toHaveBeenCalled();
  });

  it("opens menu and clicks new reaction when switching from Celebrate → Like", async () => {
    setupMocks();
    nextReactionStateText = reactionStateText("Celebrate");

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.reactionType).toBe("like");
    expect(result.alreadyReacted).toBe(false);
    expect(result.currentReaction).toBe("celebrate");
    // SDUI stack: humanizedClick on menu (opens popup) → plain click on
    // popup reaction (no mouse motion, popup stays open).  LinkedIn
    // auto-replaces the existing reaction.
    expect(humanizedClick).toHaveBeenCalledTimes(1);
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, MENU_SELECTOR, undefined);
    expect(click).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledWith(mockClient, 'button[aria-label="Like"]');
  });

  it("opens menu and clicks new reaction when switching from Like → Celebrate", async () => {
    setupMocks();
    nextReactionStateText = reactionStateText("Like");

    const result = await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "celebrate",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.reactionType).toBe("celebrate");
    expect(result.alreadyReacted).toBe(false);
    expect(humanizedClick).toHaveBeenCalledTimes(1);
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, MENU_SELECTOR, undefined);
    expect(click).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledWith(mockClient, 'button[aria-label="Celebrate"]');
  });

  it("returns dryRun for Like target — opens menu, validates popup, no reaction click", async () => {
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
    // SDUI stack: every reaction (incl. Like) goes through the popup.
    // Dry-run clicks the menu (validates the popup machinery) but skips
    // clicking the reaction button.
    expect(humanizedClick).toHaveBeenCalledTimes(1);
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, MENU_SELECTOR, undefined);
    expect(click).not.toHaveBeenCalled();
  });

  it("returns dryRun for non-Like target — opens menu but skips reaction click", async () => {
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
    expect(humanizedClick).toHaveBeenCalledTimes(1);
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, MENU_SELECTOR, undefined);
    expect(click).not.toHaveBeenCalled();
  });

  it("returns dryRun with currentReaction when a different reaction is active", async () => {
    setupMocks();
    nextReactionStateText = reactionStateText("Celebrate");

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
    // Dry-run preserves state — clicks the menu (popup-validation) but
    // does not click the reaction.  No "unreact first" step in the SDUI flow.
    expect(humanizedClick).toHaveBeenCalledTimes(1);
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, MENU_SELECTOR, undefined);
    expect(click).not.toHaveBeenCalled();
  });

  it("returns alreadyReacted with dryRun when same reaction is active", async () => {
    setupMocks();
    nextReactionStateText = reactionStateText("Like");

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
    // SDUI stack uses `componentkey^="replaceableComment_"` (lhremote#776).
    expect(waitForElement).toHaveBeenNthCalledWith(
      1,
      mockClient,
      '[componentkey^="replaceableComment_"]',
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

    // Third waitForElement: the comment-scoped reactions menu opener
    expect(waitForElement).toHaveBeenNthCalledWith(
      3,
      mockClient,
      MENU_SELECTOR,
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

  it("opens the menu via humanizedClick and clicks Like via plain click in popup (SDUI: no direct trigger)", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "like",
      cdpPort: 9222,
    });

    // SDUI stack: every reaction goes through the popup, including Like.
    // Sequence: humanizedClick on menu (opens click-anchored popup),
    // then plain `click` on reaction button (no mouse motion — popup
    // cannot close mid-motion).
    expect(humanizedClick).toHaveBeenCalledTimes(1);
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, MENU_SELECTOR, undefined);
    expect(click).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledWith(mockClient, 'button[aria-label="Like"]');
    expect(humanizedHover).not.toHaveBeenCalled();
  });

  it("clicks Open-reactions-menu when target is non-Like (popup is click-anchored)", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "celebrate",
      cdpPort: 9222,
    });

    // Non-Like target: same flow — humanizedClick opens, plain click selects.
    expect(humanizedClick).toHaveBeenCalledWith(mockClient, MENU_SELECTOR, undefined);
    expect(click).toHaveBeenCalledWith(mockClient, 'button[aria-label="Celebrate"]');
  });

  it("wraps popup wait in retryInteraction (always — SDUI uses popup for every reaction)", async () => {
    setupMocks();

    await reactToComment({
      postUrl: POST_URL,
      commentUrn: COMMENT_URN,
      reactionType: "insightful",
      cdpPort: 9222,
    });

    expect(retryInteraction).toHaveBeenCalledWith(expect.any(Function), 3);

    // Final waitForElement: the popup reaction button.  SDUI uses the
    // bare aria-label format (`button[aria-label="<Type>"]`) — same as
    // post-level reactions.
    expect(waitForElement).toHaveBeenLastCalledWith(
      mockClient,
      'button[aria-label="Insightful"]',
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

    expect(click).toHaveBeenCalledWith(mockClient, 'button[aria-label="Funny"]');
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
