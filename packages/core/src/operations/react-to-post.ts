// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedClick, humanizedHover, waitForElement } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import {
  REACTION_CELEBRATE,
  REACTION_FUNNY,
  REACTION_INSIGHTFUL,
  REACTION_LIKE,
  REACTION_LOVE,
  REACTION_SUPPORT,
  REACTION_TRIGGER,
} from "../linkedin/selectors.js";
import { gaussianDelay } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Supported LinkedIn reaction types.
 *
 * Mapping follows the Voyager API names used by LinkedIn internally:
 * - `LIKE` → Like (thumbs up)
 * - `CELEBRATE` → Celebrate (clapping hands)
 * - `SUPPORT` → Support (heart-in-hands)
 * - `LOVE` → Love (heart)
 * - `INSIGHTFUL` → Insightful (light bulb)
 * - `FUNNY` → Funny (laughing face)
 */
export type ReactionType =
  | "like"
  | "celebrate"
  | "support"
  | "love"
  | "insightful"
  | "funny";

/** Map from reaction type to its selector in the reactions popup. */
const REACTION_SELECTORS: Readonly<Record<ReactionType, string>> = {
  like: REACTION_LIKE,
  celebrate: REACTION_CELEBRATE,
  support: REACTION_SUPPORT,
  love: REACTION_LOVE,
  insightful: REACTION_INSIGHTFUL,
  funny: REACTION_FUNNY,
};

/** All valid reaction type values. */
export const REACTION_TYPES: readonly ReactionType[] = Object.keys(
  REACTION_SELECTORS,
) as ReactionType[];

export interface ReactToPostInput extends ConnectionOptions {
  /** LinkedIn post URL (any format accepted by the LinkedIn WebView). */
  readonly postUrl: string;
  /** Reaction type to apply (default: `"like"`). */
  readonly reactionType?: ReactionType | undefined;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
}

export interface ReactToPostOutput {
  readonly success: true;
  readonly postUrl: string;
  readonly reactionType: ReactionType;
}

/**
 * React to a LinkedIn post with a specified reaction type.
 *
 * Navigates to the post URL in the LinkedIn WebView, hovers over the
 * reaction trigger to expand the reaction picker, and clicks the
 * requested reaction button.
 *
 * @param input - Post URL, reaction type, and CDP connection parameters.
 * @returns Confirmation of the reaction applied.
 */
export async function reactToPost(
  input: ReactToPostInput,
): Promise<ReactToPostOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const reactionType = input.reactionType ?? "like";

  if (!REACTION_TYPES.includes(reactionType)) {
    throw new Error(
      `Invalid reaction type "${reactionType}". ` +
        `Valid types: ${REACTION_TYPES.join(", ")}`,
    );
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
    // Navigate to the post URL
    await client.navigate(input.postUrl);

    const mouse = input.mouse;

    // Wait for the reaction trigger button to appear
    await waitForElement(client, REACTION_TRIGGER, undefined, mouse);

    // Hover over the reaction trigger to expand the reactions popup
    await humanizedHover(client, REACTION_TRIGGER, mouse);
    await gaussianDelay(1_500, 150, 1_200, 1_800);

    // Wait for the specific reaction button to appear in the popup
    const reactionSelector = REACTION_SELECTORS[reactionType];
    await waitForElement(client, reactionSelector, { timeout: 5_000 }, mouse);
    await humanizedClick(client, reactionSelector, mouse);

    // Let the UI settle
    await gaussianDelay(550, 75, 400, 700);

    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
    return {
      success: true as const,
      postUrl: input.postUrl,
      reactionType,
    };
  } finally {
    client.disconnect();
  }
}
