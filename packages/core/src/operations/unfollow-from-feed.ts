// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedScrollToByIndex, retryInteraction } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { gaussianDelay, maybeHesitate } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";
import { waitForFeedLoad } from "./get-feed.js";

/** CSS selector for feed post menu buttons. */
const FEED_MENU_BUTTON_SELECTOR =
  '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]';

export interface UnfollowFromFeedInput extends ConnectionOptions {
  /** Zero-based index of the post in the visible LinkedIn feed. */
  readonly feedIndex: number;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
  /** When true, locate the menu item but do not click it. */
  readonly dryRun?: boolean | undefined;
}

export interface UnfollowFromFeedOutput {
  readonly success: true;
  readonly feedIndex: number;
  /** The name extracted from the "Unfollow {Name}" menu item. */
  readonly unfollowedName: string;
  readonly dryRun: boolean;
}

/**
 * Unfollow the author of a LinkedIn post via its feed three-dot menu.
 *
 * Navigates to the LinkedIn home feed, opens the three-dot menu of the
 * post at the given `feedIndex`, and clicks the "Unfollow {Name}" menu
 * item.  The unfollowed person's name is extracted from the menu item text.
 *
 * @param input - Feed index and CDP connection parameters.
 * @returns Confirmation including the unfollowed person's name.
 * @throws If the three-dot menu does not contain an "Unfollow" item.
 */
export async function unfollowFromFeed(
  input: UnfollowFromFeedInput,
): Promise<UnfollowFromFeedOutput> {
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

    await maybeHesitate();

    // Scroll the menu button into view by index and click it, retrying if
    // the menu does not open on the first attempt.
    const unfollowedName = await retryInteraction(async () => {
      await humanizedScrollToByIndex(client, FEED_MENU_BUTTON_SELECTOR, feedIndex, mouse);

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

      // Find and click the "Unfollow {Name}" menu item, extracting
      // the name from the text.
      const name = await client.evaluate<string | null>(`(() => {
        const dryRun = ${dryRun};
        for (const el of document.querySelectorAll('[role="menuitem"]')) {
          const text = el.textContent?.trim() ?? '';
          if (text.startsWith('Unfollow ')) {
            if (!dryRun) el.click();
            return text.slice('Unfollow '.length);
          }
        }
        return null;
      })()`);

      if (!name) {
        // Dismiss any open menu before retrying
        await client.evaluate(`(() => {
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
          );
        })()`);
        await gaussianDelay(300, 75, 200, 500);

        throw new Error(
          'No "Unfollow" item found in the post control menu. ' +
            "The post author may already be unfollowed, or the post " +
            "may not support this action.",
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

    // Let the UI settle after clicking Unfollow
    await gaussianDelay(550, 75, 400, 700);

    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
    return {
      success: true as const,
      feedIndex: input.feedIndex,
      unfollowedName,
      dryRun,
    };
  } finally {
    client.disconnect();
  }
}
