// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { humanizedClick, humanizedHover, retryInteraction, waitForDOMStable, waitForElement } from "../linkedin/dom-automation.js";
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

/** Map from display name (as it appears in aria-labels) to reaction type. */
const REACTION_NAME_MAP: Readonly<Partial<Record<string, ReactionType>>> = {
  like: "like",
  celebrate: "celebrate",
  support: "support",
  love: "love",
  insightful: "insightful",
  funny: "funny",
};

/**
 * Detect the current reaction state of the post by inspecting the
 * reaction trigger button's `aria-label`.
 *
 * - **Post page** (Ember): `"Unreact Like"`, `"Unreact Celebrate"`, etc.
 * - **Feed page** (React): `"Reaction button state: no reaction"` when
 *   unreacted; specific state name otherwise.
 *
 * @returns The current reaction type, or `null` if not reacted.
 */
async function detectCurrentReaction(
  client: CDPClient,
): Promise<ReactionType | null> {
  const label = await client.evaluate<string | null>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(REACTION_TRIGGER)});
      return el ? el.getAttribute('aria-label') : null;
    })()`,
  );

  if (!label) return null;

  // Post page: "Unreact Like", "Unreact Celebrate", etc.
  const unreactMatch = /^Unreact\s+(\w+)/i.exec(label);
  if (unreactMatch?.[1]) {
    return REACTION_NAME_MAP[unreactMatch[1].toLowerCase()] ?? null;
  }

  // Feed page: "Reaction button state: no reaction" → unreacted
  if (/no reaction/i.test(label)) return null;

  // Feed page reacted: "Reaction button state: Like", etc.
  const stateMatch = /Reaction button state:\s*(\w+)/i.exec(label);
  if (stateMatch?.[1]) {
    return REACTION_NAME_MAP[stateMatch[1].toLowerCase()] ?? null;
  }

  return null;
}

export interface ReactToPostInput extends ConnectionOptions {
  /** LinkedIn post URL (any format accepted by the LinkedIn WebView). */
  readonly postUrl: string;
  /** Reaction type to apply (default: `"like"`). */
  readonly reactionType?: ReactionType | undefined;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
  /** When true, detect the reaction state but do not click. */
  readonly dryRun?: boolean | undefined;
}

export interface ReactToPostOutput {
  readonly success: true;
  readonly postUrl: string;
  readonly reactionType: ReactionType;
  /** Whether the post was already reacted with the requested type (no-op). */
  readonly alreadyReacted: boolean;
  /** The reaction currently applied to the post (null if none). */
  readonly currentReaction: ReactionType | null;
  readonly dryRun: boolean;
}

/**
 * React to a LinkedIn post with a specified reaction type.
 *
 * Navigates to the post URL in the LinkedIn WebView and inspects the
 * reaction trigger's `aria-label` to detect the current reaction state:
 *
 * - **Not reacted**: hovers the trigger to expand the reaction picker,
 *   then clicks the requested reaction button.
 * - **Already reacted with the same type**: returns immediately as a
 *   no-op (`alreadyReacted: true`).
 * - **Already reacted with a different type**: clicks the trigger to
 *   remove the existing reaction, then applies the requested one.
 *
 * @param input - Post URL, reaction type, and CDP connection parameters.
 * @returns Confirmation of the reaction applied, including whether the
 *   post was already reacted with the requested type.
 */
export async function reactToPost(
  input: ReactToPostInput,
): Promise<ReactToPostOutput> {
  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;
  const reactionType = input.reactionType ?? "like";
  const dryRun = input.dryRun ?? false;

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

    // Detect existing reaction state from the trigger's aria-label
    const currentReaction = await detectCurrentReaction(client);

    if (currentReaction === reactionType) {
      // Already reacted with the requested type — no-op
      await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
      return {
        success: true as const,
        postUrl: input.postUrl,
        reactionType,
        alreadyReacted: true,
        currentReaction,
        dryRun,
      };
    }

    if (dryRun) {
      // Dry-run: detected state without mutating — return early
      await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
      return {
        success: true as const,
        postUrl: input.postUrl,
        reactionType,
        alreadyReacted: false,
        currentReaction,
        dryRun,
      };
    }

    if (currentReaction !== null) {
      // Reacted with a different type — click trigger to unreact first
      await humanizedClick(client, REACTION_TRIGGER, mouse);
      // Wait for DOM to settle after unreacting — the trigger element
      // gets replaced and its aria-label changes, so hovering too early
      // can target a stale position or miss the new element entirely.
      await waitForDOMStable(client, 300);
    }

    // Hover the trigger to expand the reactions popup, then wait for
    // the requested reaction button.  Wrapped in retryInteraction
    // because the popup may not appear on the first hover attempt
    // (Ember post page can be sluggish).
    //
    // IMPORTANT: waitForElement is called WITHOUT the mouse parameter
    // to disable idle cursor drift during the poll loop.  Drift moves
    // the cursor off the trigger, which collapses the hover popup
    // before the reaction button can appear.
    const reactionSelector = REACTION_SELECTORS[reactionType];
    await retryInteraction(async () => {
      await humanizedHover(client, REACTION_TRIGGER, mouse);
      await gaussianDelay(2_000, 300, 1_500, 3_000);
      await waitForElement(client, reactionSelector, { timeout: 10_000 });
    }, 3);
    await humanizedClick(client, reactionSelector, mouse);

    // Let the UI settle
    await gaussianDelay(550, 75, 400, 700);

    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell
    return {
      success: true as const,
      postUrl: input.postUrl,
      reactionType,
      alreadyReacted: false,
      currentReaction,
      dryRun,
    };
  } finally {
    client.disconnect();
  }
}
