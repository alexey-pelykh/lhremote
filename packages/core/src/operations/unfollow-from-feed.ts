// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedClick, humanizedScrollTo, retryInteraction, waitForElement } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { gaussianDelay } from "../utils/delay.js";
import { maybeHesitate } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";

/** CSS selector for the post's three-dot control menu button. */
const POST_MENU_BUTTON_SELECTOR =
  'button[aria-label^="Open control menu"]';

export interface UnfollowFromFeedInput extends ConnectionOptions {
  /** LinkedIn post URL identifying a visible feed post. */
  readonly postUrl: string;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

export interface UnfollowFromFeedOutput {
  readonly success: true;
  readonly postUrl: string;
  /** The name extracted from the "Unfollow {Name}" menu item. */
  readonly unfollowedName: string;
}

/**
 * Unfollow the author of a LinkedIn post via its feed three-dot menu.
 *
 * Navigates to the post URL, opens the three-dot control menu, and
 * clicks the "Unfollow {Name}" menu item.  The unfollowed person's
 * name is extracted from the menu item text.
 *
 * @param input - Post URL and CDP connection parameters.
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
    // Navigate to the post URL
    await client.navigate(input.postUrl);

    const mouse = input.mouse;

    // Wait for the three-dot menu button to appear
    await waitForElement(client, POST_MENU_BUTTON_SELECTOR, undefined, mouse);

    await maybeHesitate();

    // Scroll the menu button into view and click it, retrying if the
    // menu does not open on the first attempt.
    const unfollowedName = await retryInteraction(async () => {
      await humanizedScrollTo(client, POST_MENU_BUTTON_SELECTOR, mouse);
      await humanizedClick(client, POST_MENU_BUTTON_SELECTOR, mouse);

      await gaussianDelay(700, 100, 500, 900);

      // Find and click the "Unfollow {Name}" menu item, extracting
      // the name from the text.
      const name = await client.evaluate<string | null>(`(() => {
        for (const el of document.querySelectorAll('[role="menuitem"]')) {
          const text = el.textContent.trim();
          if (text.startsWith('Unfollow ')) {
            el.click();
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

    // Let the UI settle after clicking Unfollow
    await gaussianDelay(550, 75, 400, 700);

    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
    return {
      success: true as const,
      postUrl: input.postUrl,
      unfollowedName,
    };
  } finally {
    client.disconnect();
  }
}
