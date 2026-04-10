// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedScrollToByIndex } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { gaussianDelay, maybeHesitate } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";
import { navigateAwayIf } from "./navigate-away.js";
import { waitForFeedLoad } from "./get-feed.js";

/** CSS selector for feed post menu buttons. */
const FEED_MENU_BUTTON_SELECTOR =
  '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]';

export interface DismissFeedPostInput extends ConnectionOptions {
  /** Zero-based index of the post in the visible LinkedIn feed. */
  readonly feedIndex: number;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
  /** When true, locate the menu item but do not click it. */
  readonly dryRun?: boolean | undefined;
}

export interface DismissFeedPostOutput {
  readonly success: true;
  readonly feedIndex: number;
  readonly dryRun: boolean;
}

/**
 * Open the three-dot menu for a feed post at the given index and click
 * the "Not interested" menu item.
 *
 * @returns `true` if "Not interested" was clicked, `false` if the menu
 *   item was not found.
 * @throws If the menu button could not be clicked.
 */
async function clickNotInterested(
  client: CDPClient,
  postIndex: number,
  mouse?: HumanizedMouse | null,
  dryRun?: boolean,
): Promise<boolean> {
  await maybeHesitate();

  await humanizedScrollToByIndex(client, FEED_MENU_BUTTON_SELECTOR, postIndex, mouse);

  const clicked = await client.evaluate<boolean>(`(() => {
    const btns = document.querySelectorAll(
      ${JSON.stringify(FEED_MENU_BUTTON_SELECTOR)}
    );
    const btn = btns[${postIndex}];
    if (!btn) return false;
    btn.click();
    return true;
  })()`);

  if (!clicked) {
    throw new Error(
      "Failed to open the three-dot menu for the target post.",
    );
  }

  await gaussianDelay(700, 100, 500, 900);

  const dismissed = await client.evaluate<boolean>(`(() => {
    const dryRun = ${!!dryRun};
    for (const el of document.querySelectorAll('[role="menuitem"]')) {
      if (el.textContent.trim() === 'Not interested') {
        if (!dryRun) el.click();
        return true;
      }
    }
    return false;
  })()`);

  if (!dismissed) {
    // Dismiss the open menu to avoid leaving the UI in a modal state
    await client.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);
    await gaussianDelay(300, 75, 200, 500);
  }

  if (dismissed && dryRun) {
    await client.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);
    await gaussianDelay(300, 75, 200, 500);
  }

  return dismissed;
}

/**
 * Dismiss a post from the LinkedIn feed by clicking "Not interested".
 *
 * Navigates to the LinkedIn home feed, opens the three-dot menu of the
 * post at the given `feedIndex`, and clicks "Not interested".
 *
 * @param input - Feed index, CDP connection parameters, and optional mouse.
 * @returns Confirmation that the post was dismissed.
 * @throws When the menu button is not found or "Not interested" is not
 *   available in its menu.
 */
export async function dismissFeedPost(
  input: DismissFeedPostInput,
): Promise<DismissFeedPostOutput> {
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

    // Click "Not interested" on the post at the given feed index
    const dismissed = await clickNotInterested(client, feedIndex, mouse, dryRun);

    if (!dismissed) {
      throw new Error(
        'The post\'s three-dot menu does not contain "Not interested". ' +
          "This may happen for your own posts or sponsored content.",
      );
    }

    await gaussianDelay(550, 75, 400, 700);
    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
    return {
      success: true as const,
      feedIndex: input.feedIndex,
      dryRun,
    };
  } finally {
    client.disconnect();
  }
}
