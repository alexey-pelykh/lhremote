// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CDPClient } from "../cdp/client.js";
import { gaussianDelay } from "../utils/delay.js";

/** Lightweight LinkedIn page used as a navigation-away target. */
const AWAY_URL = "https://www.linkedin.com/mynetwork/";

/**
 * Navigate away from the current page if its pathname contains the given
 * prefix.  This forces LinkedIn's SPA to perform a full page load (and
 * fire fresh API requests) on the subsequent navigation, even when the
 * browser is already on the target page.
 *
 * After navigating, a Gaussian-distributed delay simulates the human
 * wait for the page transition to settle.
 *
 * No-op when the current pathname does NOT contain `pathPrefix`.
 */
export async function navigateAwayIf(
  client: CDPClient,
  pathPrefix: string,
): Promise<void> {
  const pathname = await client.evaluate<string>("location.pathname");
  if (pathname.includes(pathPrefix)) {
    await client.navigate(AWAY_URL);
    await gaussianDelay(1_500, 500, 800, 3_000);
  }
}
