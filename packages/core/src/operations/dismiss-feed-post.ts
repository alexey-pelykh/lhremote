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
import { scrollFeed, waitForFeedLoad } from "./get-feed.js";

/** CSS selector for feed post menu buttons. */
const FEED_MENU_BUTTON_SELECTOR =
  '[data-testid="mainFeed"] div[role="listitem"] button[aria-label^="Open control menu for post"]';

export interface DismissFeedPostInput extends ConnectionOptions {
  /** LinkedIn post URL identifying a visible feed post. */
  readonly postUrl: string;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

export interface DismissFeedPostOutput {
  readonly success: true;
  readonly postUrl: string;
}

/**
 * Open the three-dot menu for a feed post at the given index, click
 * "Copy link to post", and return the captured URL (query params stripped).
 *
 * Returns `null` when the menu button doesn't exist or the clipboard
 * capture fails after up to 3 attempts (matching the retry behaviour of
 * the identical helper in `get-feed.ts`).
 */
async function capturePostUrl(
  client: CDPClient,
  postIndex: number,
  mouse?: HumanizedMouse | null,
): Promise<string | null> {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await maybeHesitate();

    await client.evaluate(`window.__capturedClipboard = null;`);

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

    if (!clicked) return null;

    await gaussianDelay(700, 100, 500, 900);

    await client.evaluate(`(() => {
      for (const el of document.querySelectorAll('[role="menuitem"]')) {
        if (el.textContent.trim() === 'Copy link to post') {
          el.click();
          return;
        }
      }
    })()`);

    await gaussianDelay(550, 75, 400, 700);

    const postUrl =
      await client.evaluate<string | null>(`window.__capturedClipboard`);

    if (postUrl) {
      return postUrl.split("?")[0] ?? postUrl;
    }

    // Dismiss any open menu before retrying
    await client.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);

    await gaussianDelay(700 * (attempt + 1), 200, 350 * (attempt + 1), 1_050 * (attempt + 1));
  }

  return null;
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
    for (const el of document.querySelectorAll('[role="menuitem"]')) {
      if (el.textContent.trim() === 'Not interested') {
        el.click();
        return true;
      }
    }
    return false;
  })()`);

  return dismissed;
}

/**
 * Dismiss a post from the LinkedIn feed by clicking "Not interested".
 *
 * Navigates to the LinkedIn home feed, locates the post whose URL matches
 * the given `postUrl` (extracted via the three-dot menu → "Copy link to
 * post" clipboard trick), then reopens the menu and clicks "Not interested".
 *
 * @param input - Post URL, CDP connection parameters, and optional mouse.
 * @returns Confirmation that the post was dismissed.
 * @throws When the post is not found in the feed or "Not interested" is
 *   not available in its menu.
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
    const targetUrl = input.postUrl.split("?")[0];

    // Navigate to the feed (force fresh load if already there)
    await navigateAwayIf(client, "/feed");
    await client.navigate("https://www.linkedin.com/feed/");
    await waitForFeedLoad(client);

    // Install clipboard interceptor (Electron's clipboard API is broken)
    await client.evaluate(
      `navigator.clipboard.writeText = function(text) {
        window.__capturedClipboard = text;
        return Promise.resolve();
      };`,
    );

    const maxScrollAttempts = 5;
    let checkedUpTo = 0;

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const postCount = await client.evaluate<number>(
        `document.querySelectorAll(${JSON.stringify(FEED_MENU_BUTTON_SELECTOR)}).length`,
      );

      for (let i = checkedUpTo; i < postCount; i++) {
        if (i > checkedUpTo) {
          await gaussianDelay(550, 125, 300, 800);
        }

        const url = await retryInteraction(
          () => capturePostUrl(client, i, mouse),
        );

        if (url && url === targetUrl) {
          // Found the target post — click "Not interested"
          const dismissed = await clickNotInterested(client, i, mouse);

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
            postUrl: input.postUrl,
          };
        }
      }

      checkedUpTo = postCount;

      // Scroll to load more posts
      if (scroll < maxScrollAttempts) {
        await scrollFeed(client, mouse);
        await gaussianDelay(1_500, 300, 1_000, 2_500);
      }
    }

    throw new Error(
      `Post not found in the feed: ${input.postUrl}. ` +
        "Ensure the post is visible in the LinkedIn feed.",
    );
  } finally {
    client.disconnect();
  }
}
