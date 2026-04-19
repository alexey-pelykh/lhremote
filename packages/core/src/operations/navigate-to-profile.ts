// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CDPClient } from "../cdp/client.js";
import { waitForElement } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { gaussianDelay, maybeHesitate } from "../utils/delay.js";
import { navigateAwayIf } from "./navigate-away.js";

/**
 * Regex matching a LinkedIn profile URL *pathname* (not the full URL) and
 * capturing the public ID from the first `/in/{slug}` segment.
 */
export const LINKEDIN_PROFILE_RE = /^\/in\/([^/?#]+)/;

/** Selector that identifies a loaded profile page (name card heading). */
const PROFILE_READY_SELECTOR = "main h1";

/**
 * Extract the public ID (URL slug) from a LinkedIn profile URL.
 *
 * The URL is parsed with {@link URL} and validated: the hostname must end
 * with `linkedin.com` and the pathname must start with `/in/{publicId}`.
 * The captured slug is URL-decoded before being returned.  Relative URLs,
 * query-embedded profile links (e.g. `?next=https://.../in/foo`), and
 * non-LinkedIn hosts are all rejected with a descriptive error.
 *
 * @throws If `url` is not a well-formed LinkedIn profile URL.
 */
export function extractPublicId(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Invalid LinkedIn profile URL: ${url}. Expected format: https://www.linkedin.com/in/<public-id>`,
    );
  }

  const host = parsed.hostname.toLowerCase();
  const isLinkedInHost = host === "linkedin.com" || host.endsWith(".linkedin.com");
  if (!isLinkedInHost) {
    throw new Error(
      `Invalid LinkedIn profile URL: ${url}. Expected format: https://www.linkedin.com/in/<public-id>`,
    );
  }

  const match = LINKEDIN_PROFILE_RE.exec(parsed.pathname);
  if (!match?.[1]) {
    throw new Error(
      `Invalid LinkedIn profile URL: ${url}. Expected format: https://www.linkedin.com/in/<public-id>`,
    );
  }
  return decodeURIComponent(match[1]);
}

/**
 * Build a canonical LinkedIn profile URL from a public ID.
 *
 * The public ID is URL-encoded before interpolation so values containing
 * characters like `%` (non-ASCII slugs) produce valid URLs.
 */
export function buildProfileUrl(publicId: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`;
}

/**
 * Navigate the CDP-controlled LinkedIn tab to the profile identified by
 * `publicId`, forcing a full reload if the tab is already on a profile page.
 *
 * After navigation, waits for the profile heading (`main h1`) to appear
 * and inserts a short humanized dwell to let the SPA render action buttons.
 *
 * @param client   - Connected CDP client targeting a LinkedIn page.
 * @param publicId - LinkedIn public ID (URL slug), e.g. `"jane-doe-123"`.
 * @param mouse    - Optional humanized mouse for idle drift during waits.
 */
export async function navigateToProfile(
  client: CDPClient,
  publicId: string,
  mouse?: HumanizedMouse | null | undefined,
): Promise<void> {
  await navigateAwayIf(client, "/in/");
  await client.navigate(buildProfileUrl(publicId));
  await waitForElement(client, PROFILE_READY_SELECTOR, { timeout: 30_000 }, mouse);
  // Let the SPA finish hydrating action buttons (Follow, More, Message).
  await gaussianDelay(800, 200, 500, 1_500);
  await maybeHesitate();
}
