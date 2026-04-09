// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedClick, humanizedScrollToByIndex, retryInteraction, waitForElement } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { FEED_POST_CONTAINER } from "../linkedin/selectors.js";
import { gaussianDelay } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";

/** CSS selector for feed post menu buttons. */
const FEED_MENU_BUTTON_SELECTOR =
  '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]';

/** Prefix of the "Hide posts by {Name}" menu item text. */
const HIDE_POSTS_PREFIX = "Hide posts by ";

export interface HideFeedAuthorInput extends ConnectionOptions {
  /** LinkedIn post URL identifying the feed post whose author to hide. */
  readonly postUrl: string;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

export interface HideFeedAuthorOutput {
  readonly success: true;
  readonly postUrl: string;
  /** Name extracted from the "Hide posts by {Name}" menu item. */
  readonly hiddenName: string;
}

/**
 * Hide posts by a feed author via the three-dot menu on a feed post.
 *
 * Navigates to the LinkedIn feed, locates the post matching
 * {@link HideFeedAuthorInput.postUrl}, opens its three-dot menu, and
 * clicks the "Hide posts by {Name}" menu item.
 *
 * @param input - Post URL and CDP connection parameters.
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

    // Navigate to the post URL — LinkedIn redirects post URLs to the
    // feed page with the target post scrolled into view.
    await client.navigate(input.postUrl);

    // Wait for the feed to render
    await waitForElement(client, FEED_POST_CONTAINER, undefined, mouse);

    // Find the index of the target post's menu button in the feed
    const postIndex = await client.evaluate<number>(`(() => {
      const btns = document.querySelectorAll(
        ${JSON.stringify(FEED_MENU_BUTTON_SELECTOR)}
      );
      return btns.length > 0 ? 0 : -1;
    })()`);

    if (postIndex < 0) {
      throw new Error(
        "No feed post menu button found. " +
          "Ensure the post URL points to a visible feed post.",
      );
    }

    // Open the three-dot menu with retry logic
    const hiddenName = await retryInteraction(async () => {
      // Scroll menu button into view
      await humanizedScrollToByIndex(
        client,
        FEED_MENU_BUTTON_SELECTOR,
        postIndex,
        mouse,
      );

      // Click the menu button
      await humanizedClick(client, FEED_MENU_BUTTON_SELECTOR, mouse);
      await gaussianDelay(700, 100, 500, 900);

      // Find and click "Hide posts by {Name}" menu item
      const name = await client.evaluate<string | null>(`(() => {
        for (const el of document.querySelectorAll('[role="menuitem"]')) {
          const text = el.textContent.trim();
          if (text.startsWith(${JSON.stringify(HIDE_POSTS_PREFIX)})) {
            el.click();
            return text.slice(${HIDE_POSTS_PREFIX.length});
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

    // Let the UI settle after clicking
    await gaussianDelay(550, 75, 400, 700);

    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell

    return {
      success: true as const,
      postUrl: input.postUrl,
      hiddenName,
    };
  } finally {
    client.disconnect();
  }
}
