// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import type { PostEngager } from "../types/post-analytics.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import type { ConnectionOptions } from "./types.js";
import { extractPostUrn, resolvePostDetailUrl } from "./get-post-stats.js";
import { delay, gaussianDelay, gaussianBetween, maybeHesitate } from "../utils/delay.js";
import { humanizedScrollTo, humanizedClick } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { navigateAwayIf } from "./navigate-away.js";

/**
 * Input for the get-post-engagers operation.
 */
export interface GetPostEngagersInput extends ConnectionOptions {
  /** LinkedIn post URL or raw URN (e.g. `urn:li:activity:1234567890`). */
  readonly postUrl: string;
  /** Number of engagers to return per page (default: 20). */
  readonly count?: number | undefined;
  /** Offset for pagination (default: 0). */
  readonly start?: number | undefined;
  /** Optional humanized mouse for natural cursor movement and scrolling. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

/**
 * Output from the get-post-engagers operation.
 */
export interface GetPostEngagersOutput {
  /** Resolved post URN. */
  readonly postUrn: string;
  /** List of people who engaged with the post. */
  readonly engagers: PostEngager[];
  /** Pagination metadata. */
  readonly paging: {
    readonly start: number;
    readonly count: number;
    readonly total: number;
  };
}

// ---------------------------------------------------------------------------
// Raw shape returned by the in-page scraping script
// ---------------------------------------------------------------------------

interface RawEngager {
  firstName: string;
  lastName: string;
  publicId: string | null;
  headline: string | null;
  engagementType: string;
}

// ---------------------------------------------------------------------------
// In-page DOM scraping scripts
// ---------------------------------------------------------------------------

/**
 * JavaScript source evaluated inside the LinkedIn post detail page to
 * find the reactions count element and mark it with a data attribute
 * for subsequent humanized scroll + click.
 *
 * Returns `true` if a reactions element was found and marked.
 */
const FIND_REACTIONS_SCRIPT = `(() => {
  const candidates = document.querySelectorAll('button, [role="button"], span, a');
  for (const el of candidates) {
    const txt = (el.textContent || '').trim();
    if (/^\\d[\\d,]*\\s+reactions?$/i.test(txt) && el.offsetHeight > 0) {
      el.setAttribute('data-lhremote-reactions', 'true');
      return true;
    }
  }
  return false;
})()`;

/** Selector for the marked reactions element. */
const REACTIONS_SELECTOR = "[data-lhremote-reactions]";

/**
 * JavaScript source that extracts engager data from the reactions modal.
 *
 * The modal (`[role="dialog"]`) contains a scrollable list of people who
 * reacted to the post.  Each entry has a profile link (`a[href*="/in/"]`),
 * name text, headline, and a small reaction-type icon overlay.
 */
const SCRAPE_ENGAGERS_SCRIPT = `(() => {
  const engagers = [];
  const modal = document.querySelector('[role="dialog"]');
  if (!modal) return engagers;

  const seen = new Set();
  const profileLinks = modal.querySelectorAll('a[href*="/in/"]');

  for (const link of profileLinks) {
    const href = (link.href || '').split('?')[0];
    if (seen.has(href)) continue;
    seen.add(href);

    const idMatch = href.match(/\\/in\\/([^/?]+)/);
    const publicId = idMatch ? idMatch[1] : null;

    const nameSpan = link.querySelector('span[dir="ltr"], span[aria-hidden="true"]');
    let name = nameSpan ? (nameSpan.textContent || '').trim() : '';
    if (!name) {
      name = (link.textContent || '').trim().split('\\n')[0].trim();
    }

    const nameParts = name.split(/\\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    if (!firstName) continue;

    const entry = link.closest('li') || link.closest('[class]');

    let headline = null;
    if (entry) {
      const spans = entry.querySelectorAll('span');
      for (const span of spans) {
        const txt = (span.textContent || '').trim();
        if (
          txt &&
          txt.length > 3 &&
          txt.length < 200 &&
          txt !== name &&
          !txt.match(/^Follow$/i) &&
          !txt.match(/^Connect$/i) &&
          !txt.match(/^Pending$/i) &&
          !txt.match(/^Message$/i) &&
          !txt.match(/^\\d[\\d,]*\\s+(reactions?|comments?)$/i)
        ) {
          headline = txt;
          break;
        }
      }
    }

    let engagementType = 'LIKE';
    if (entry) {
      const imgs = entry.querySelectorAll('img[alt]');
      for (const img of imgs) {
        const alt = (img.alt || '').toLowerCase();
        if (alt.includes('celebrate') || alt.includes('clap')) { engagementType = 'PRAISE'; break; }
        if (alt.includes('support') || alt.includes('care')) { engagementType = 'EMPATHY'; break; }
        if (alt.includes('love') || alt.includes('heart')) { engagementType = 'APPRECIATION'; break; }
        if (alt.includes('insightful') || alt.includes('light')) { engagementType = 'INTEREST'; break; }
        if (alt.includes('funny') || alt.includes('laugh')) { engagementType = 'ENTERTAINMENT'; break; }
        if (alt.includes('like') || alt.includes('thumb')) { engagementType = 'LIKE'; break; }
      }
    }

    engagers.push({ firstName, lastName, publicId, headline, engagementType });
  }

  return engagers;
})()`;

/**
 * Build a scroll-modal script with a randomised scroll distance.
 *
 * The distance varies between 350–650 px to avoid the detection signal
 * of a perfectly uniform modal scroll cadence.
 */
function createScrollModalScript(distance: number): string {
  return `(() => {
  const modal = document.querySelector('[role="dialog"]');
  if (!modal) return false;

  const divs = modal.querySelectorAll('div');
  let scrollable = null;
  for (const div of divs) {
    const style = getComputedStyle(div);
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      div.scrollHeight > div.clientHeight
    ) {
      scrollable = div;
      break;
    }
  }

  if (!scrollable) scrollable = modal;

  const prev = scrollable.scrollTop;
  scrollable.scrollTop += ${String(distance)};
  return scrollable.scrollTop > prev;
})()`;
}

/**
 * JavaScript source that extracts the total reactions count from the
 * reactions modal header text (e.g. "42 Reactions" or "All (42)").
 */
const GET_MODAL_TOTAL_SCRIPT = `(() => {
  const modal = document.querySelector('[role="dialog"]');
  if (!modal) return 0;

  const text = modal.textContent || '';
  const match = text.match(/(\\d[\\d,]*)\\s+reactions?/i);
  if (match) return parseInt(match[1].replace(/,/g, ''), 10);

  const allMatch = text.match(/All\\s*\\((\\d[\\d,]*)\\)/i);
  if (allMatch) return parseInt(allMatch[1].replace(/,/g, ''), 10);

  return 0;
})()`;

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

/**
 * Poll the DOM until the post detail page has rendered.  The page is
 * considered ready when an author link and at least one `span[dir="ltr"]`
 * are present.
 */
async function waitForPostLoad(
  client: CDPClient,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(`(() => {
      const authorLink = document.querySelector('a[href*="/in/"], a[href*="/company/"]');
      if (!authorLink) return false;
      const ltrSpans = document.querySelectorAll('span[dir="ltr"]');
      return ltrSpans.length > 0;
    })()`);
    if (ready) return;
    await delay(500);
  }
  throw new Error(
    "Timed out waiting for post detail to appear in the DOM",
  );
}

/**
 * Poll the DOM until the reactions modal has loaded with at least one
 * profile link visible.
 */
async function waitForReactionsModal(
  client: CDPClient,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(`(() => {
      const modal = document.querySelector('[role="dialog"]');
      if (!modal) return false;
      return modal.querySelectorAll('a[href*="/in/"]').length > 0;
    })()`);
    if (ready) return;
    await delay(500);
  }
  throw new Error(
    "Timed out waiting for reactions modal to appear",
  );
}

// ---------------------------------------------------------------------------
// Main operation
// ---------------------------------------------------------------------------

/**
 * Retrieve the list of people who engaged with a LinkedIn post.
 *
 * Connects to the LinkedIn webview in LinkedHelper, navigates to the
 * post detail page, opens the reactions modal via UI interaction, and
 * extracts engager data from the rendered DOM.
 *
 * @param input - Post URL or URN, pagination parameters, and CDP connection options.
 * @returns List of engagers with pagination metadata.
 */
export async function getPostEngagers(
  input: GetPostEngagersInput,
): Promise<GetPostEngagersOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const count = input.count ?? 20;
  const start = input.start ?? 0;

  const postDetailUrl = resolvePostDetailUrl(input.postUrl);

  // Try to extract URN for the output postUrn field
  let postUrn: string;
  try {
    postUrn = extractPostUrn(input.postUrl);
  } catch {
    postUrn = input.postUrl;
  }

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
    // Navigate away if already on the post detail page to force a fresh load
    await navigateAwayIf(client, "/feed/update/");

    // Navigate to the post detail page
    await client.navigate(postDetailUrl);

    // Wait for the post content to render
    await waitForPostLoad(client);

    const mouse = input.mouse ?? null;

    // Find the reactions count element and mark it
    const found = await client.evaluate<boolean>(FIND_REACTIONS_SCRIPT);
    if (!found) {
      // No reactions on this post — return empty
      return {
        postUrn,
        engagers: [],
        paging: { start, count: 0, total: 0 },
      };
    }

    // Humanized scroll to the reactions element and click it
    await maybeHesitate(); // Probabilistic pause before interaction
    await humanizedScrollTo(client, REACTIONS_SELECTOR, mouse);
    await humanizedClick(client, REACTIONS_SELECTOR, mouse);

    // Wait for the reactions modal to load
    await waitForReactionsModal(client);

    // Extract total from modal header
    const total = await client.evaluate<number>(GET_MODAL_TOTAL_SCRIPT);

    // Scroll and collect engagers until we have enough or can't load more
    const targetCount = start + count;
    let allEngagers: RawEngager[] = [];
    const maxScrollAttempts = 20;

    for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
      const scraped =
        await client.evaluate<RawEngager[]>(SCRAPE_ENGAGERS_SCRIPT);
      allEngagers = scraped ?? [];

      if (allEngagers.length >= targetCount) break;

      if (scroll < maxScrollAttempts) {
        const modalDistance = Math.round(gaussianBetween(500, 75, 350, 650));
        const scrolled =
          await client.evaluate<boolean>(createScrollModalScript(modalDistance));
        if (!scrolled) break;
        await gaussianDelay(1_000, 100, 800, 1_200);
      }
    }

    // Close the modal
    await client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
    });

    // Apply pagination window
    const sliced = allEngagers.slice(start, start + count);
    const engagers: PostEngager[] = sliced.map((e) => ({
      firstName: e.firstName,
      lastName: e.lastName,
      publicId: e.publicId,
      headline: e.headline,
      engagementType: e.engagementType,
    }));

    await gaussianDelay(800, 300, 300, 1_800); // Post-action dwell
    return {
      postUrn,
      engagers,
      paging: {
        start,
        count: engagers.length,
        total: total || allEngagers.length,
      },
    };
  } finally {
    client.disconnect();
  }
}
