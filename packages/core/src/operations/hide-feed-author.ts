// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedScrollToByIndex, retryInteraction } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { gaussianDelay } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";
import { waitForFeedLoad } from "./get-feed.js";

/** CSS selector for feed post menu buttons. */
const FEED_MENU_BUTTON_SELECTOR =
  '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]';

/** Prefix of the "Hide posts by {Name}" menu item text. */
const HIDE_POSTS_PREFIX = "Hide posts by ";

export interface HideFeedAuthorInput extends ConnectionOptions {
  /** Zero-based index of the post in the visible LinkedIn feed. */
  readonly feedIndex: number;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
  /** When true, locate the menu item but do not click it. */
  readonly dryRun?: boolean | undefined;
}

export interface HideFeedAuthorOutput {
  readonly success: true;
  readonly feedIndex: number;
  /** Name extracted from the "Hide posts by {Name}" menu item. */
  readonly hiddenName: string;
  readonly dryRun: boolean;
}

/**
 * Hide posts by a person via the three-dot menu on a feed post.
 *
 * Navigates to the LinkedIn home feed, opens the three-dot menu of
 * the post at the given `feedIndex`, and clicks the "Hide posts by
 * {Name}" menu item.
 *
 * **Note:** The name in the menu may differ from the post's
 * original author (e.g. when the post is a repost).
 *
 * @param input - Feed index and CDP connection parameters.
 * @returns Confirmation including the name extracted from the menu item.
 */
export async function hideFeedAuthor(
  input: HideFeedAuthorInput,
): Promise<HideFeedAuthorOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;

  // Enforce loopback guard
  if (!allowRemote && cdpHost !== "127.0.0.1" && cdpHost !== "localhost") {
    throw new Error(
      `Non-loopback CDP host "${cdpHost}" requires --allow-remote. ` +
        "This is a security measure to prevent remote code execution.",
    );
  }

  const targets = await discoverTargets(cdpPort, cdpHost);
  const linkedInTarget = targets.find(
    (t) => t.type === "page" && t.url?.includes("linkedin.com"),
  );

  if (!linkedInTarget) {
    throw new Error(
      "No LinkedIn page found in LinkedHelper. " +
        "Ensure LinkedHelper is running with an active LinkedIn session.",
    );
  }

  const client = new CDPClient(cdpPort, { host: cdpHost, allowRemote });
  await client.connect(linkedInTarget.id);

  try {
    const mouse = input.mouse;
    const dryRun = input.dryRun ?? false;
    const feedIndex = input.feedIndex;

    // Navigate to the feed (force fresh load if already there)
    await navigateAwayIf(client, "/feed");
    await client.navigate("https://www.linkedin.com/feed/");
    await waitForFeedLoad(client);

    // Open the three-dot menu with retry logic
    const hiddenName = await retryInteraction(async () => {
      // Scroll menu button into view
      await humanizedScrollToByIndex(
        client,
        FEED_MENU_BUTTON_SELECTOR,
        feedIndex,
        mouse,
      );

      // Click the specific menu button by index (not the first match)
      const clicked = await client.evaluate<boolean>(`(() => {
        const btns = document.querySelectorAll(
          ${JSON.stringify(FEED_MENU_BUTTON_SELECTOR)}
        );
        const btn = btns[${feedIndex}];
        if (!btn) return false;
        btn.click();
        return true;
      })()`);

      if (!clicked) {
        throw new Error(
          "No feed post menu button found. " +
            "Ensure the feed index points to a visible feed post.",
        );
      }

      await gaussianDelay(700, 100, 500, 900);

      // Find and click "Hide posts by {Name}" menu item
      const name = await client.evaluate<string | null>(`(() => {
        const dryRun = ${dryRun};
        for (const el of document.querySelectorAll('[role="menuitem"]')) {
          const text = el.textContent.trim();
          if (text.startsWith(${JSON.stringify(HIDE_POSTS_PREFIX)})) {
            const name = text.slice(${HIDE_POSTS_PREFIX.length}).trim();
            if (!name) return null;
            if (!dryRun) el.click();
            return name;
          }
        }
        return null;
      })()`);

      if (!name) {
        // Dismiss menu before retry
        await client.evaluate(`(() => {
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
          );
        })()`);
        throw new Error(
          `No "Hide posts by" menu item found in the post's three-dot menu.`,
        );
      }

      return name;
    }, 3);

    if (dryRun) {
      await client.evaluate(`(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      })()`);
      await gaussianDelay(300, 75, 200, 500);
    }

    // Let the UI settle after clicking
    await gaussianDelay(550, 75, 400, 700);

    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell

    return {
      success: true as const,
      feedIndex: input.feedIndex,
      hiddenName,
      dryRun,
    };
  } finally {
    client.disconnect();
  }
}
