// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { resolveInstancePort } from "../cdp/index.js";
import { retryInteraction, waitForElement } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { gaussianDelay } from "../utils/delay.js";
import { extractPublicId, navigateToProfile } from "./navigate-to-profile.js";
import type { ConnectionOptions } from "./types.js";

/** CSS selector for the profile-page overflow action menu button. */
const PROFILE_MORE_BUTTON_SELECTOR =
  'main button[aria-label="More actions"], main button[aria-label="More"]';

/** Prefix of the "Mute {Name}" menu item text in the profile More menu. */
const MUTE_MENUITEM_PREFIX = "Mute ";

/** Prefix of the "Unmute {Name}" menu item text (shown when already muted). */
const UNMUTE_MENUITEM_PREFIX = "Unmute ";

/**
 * Button labels that confirm a Mute action when LinkedIn presents a
 * two-step confirmation dialog (the dialog variant varies by locale and
 * account state).
 */
const MUTE_CONFIRM_LABEL_PATTERNS = ["Mute", "Confirm"];

/**
 * Reason why a hide/mute action was not performed.  Returned on the
 * structured result instead of throwing so callers can iterate through
 * bulk lists without unwinding the operation on expected misses.
 */
export type HideFeedAuthorProfileSkipReason =
  | "mute_not_available"
  | "already_muted";

export interface HideFeedAuthorProfileInput extends ConnectionOptions {
  /** LinkedIn profile URL (e.g. `https://www.linkedin.com/in/{publicId}/`). */
  readonly profileUrl: string;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
  /**
   * When true, open the More menu and detect mute availability but do not
   * click Mute.  Useful to probe whether an author can be muted.
   */
  readonly dryRun?: boolean | undefined;
}

interface HideFeedAuthorProfileSuccess {
  readonly success: true;
  readonly profileUrl: string;
  readonly publicId: string;
  readonly muted: boolean;
  /** Name extracted from the "Mute {Name}" menu item (e.g. `"Jane Doe"`). */
  readonly hiddenName: string;
  readonly dryRun: boolean;
}

interface HideFeedAuthorProfileSkip {
  readonly success: false;
  readonly profileUrl: string;
  readonly publicId: string;
  readonly muted: false;
  readonly reason: HideFeedAuthorProfileSkipReason;
  readonly dryRun: boolean;
}

export type HideFeedAuthorProfileOutput =
  | HideFeedAuthorProfileSuccess
  | HideFeedAuthorProfileSkip;

/**
 * Hide posts by a profile author via the profile page's More menu.
 *
 * Unlike {@link hideFeedAuthor}, this operation does not require the
 * author to be currently visible in the home feed.  It navigates directly
 * to the profile page and invokes LinkedIn's "Mute" action from the
 * profile's overflow action menu.
 *
 * **Availability**: LinkedIn exposes "Mute {Name}" on the profile page
 * primarily for 1st-degree connections.  When the menu item is not
 * available (non-connection, private profile, blocked), this operation
 * returns `{ success: false, reason: "mute_not_available" }` rather than
 * throwing, so bulk workflows can continue.
 *
 * When the profile is already muted, the menu shows "Unmute {Name}"; we
 * detect this and return `{ success: false, reason: "already_muted" }`
 * without clicking.
 *
 * @param input - Profile URL and CDP connection parameters.
 * @returns Structured result indicating whether mute was applied, skipped,
 * or was already in the target state.
 */
export async function hideFeedAuthorProfile(
  input: HideFeedAuthorProfileInput,
): Promise<HideFeedAuthorProfileOutput> {
  const publicId = extractPublicId(input.profileUrl);

  const cdpPort = await resolveInstancePort(input.cdpPort, input.cdpHost);
  const cdpHost = input.cdpHost ?? "127.0.0.1";
  const allowRemote = input.allowRemote ?? false;

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

    await navigateToProfile(client, publicId, mouse);

    // Open the More menu with retry — the button may render asynchronously.
    const outcome = await retryInteraction(async () => {
      await waitForElement(
        client,
        PROFILE_MORE_BUTTON_SELECTOR,
        { timeout: 10_000 },
        mouse,
      );

      const clicked = await client.evaluate<boolean>(`(() => {
        const btn = document.querySelector(
          ${JSON.stringify(PROFILE_MORE_BUTTON_SELECTOR)}
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()`);

      if (!clicked) {
        throw new Error(
          `Failed to open the profile More menu for "${publicId}".`,
        );
      }

      await gaussianDelay(700, 100, 500, 900);

      // Scan menu items for Mute/Unmute prefixes.  "Mute {Name}" indicates
      // the action is available; "Unmute {Name}" indicates the profile is
      // already muted.
      const item = await client.evaluate<
        | { kind: "mute"; name: string }
        | { kind: "unmute"; name: string }
        | { kind: "none" }
      >(`(() => {
        const dryRun = ${String(dryRun)};
        const mutePrefix = ${JSON.stringify(MUTE_MENUITEM_PREFIX)};
        const unmutePrefix = ${JSON.stringify(UNMUTE_MENUITEM_PREFIX)};
        let mute = null;
        let unmute = null;
        for (const el of document.querySelectorAll('[role="menuitem"], [role="menu"] button, [role="menu"] a')) {
          const text = (el.textContent || "").trim();
          if (!unmute && text.startsWith(unmutePrefix)) {
            const name = text.slice(unmutePrefix.length).trim();
            if (name) unmute = { kind: "unmute", name };
          } else if (!mute && text.startsWith(mutePrefix)) {
            const name = text.slice(mutePrefix.length).trim();
            if (name) mute = { kind: "mute", name, node: el };
          }
        }
        // Prefer Unmute detection (unambiguous already-muted signal).
        if (unmute) return unmute;
        if (mute) {
          if (!dryRun) mute.node.click();
          return { kind: mute.kind, name: mute.name };
        }
        return { kind: "none" };
      })()`);

      // If we actually clicked Mute, LinkedIn sometimes presents a
      // two-step confirmation dialog ("Mute {Name}? [Cancel][Mute]").
      // Detect and click the confirmation button BEFORE the outer Escape
      // dismiss runs, otherwise Escape would cancel the mute while we
      // report success.
      if (item.kind === "mute" && !dryRun) {
        await gaussianDelay(500, 100, 300, 800);
        await client.evaluate(`(() => {
          const patterns = ${JSON.stringify(MUTE_CONFIRM_LABEL_PATTERNS)};
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return false;
          for (const btn of dialog.querySelectorAll('button')) {
            const text = (btn.textContent || "").trim();
            if (patterns.some((p) => text === p || text.startsWith(p + " "))) {
              btn.click();
              return true;
            }
          }
          return false;
        })()`);
      }

      return item;
    }, 3);

    // Always dismiss any open menu/dialog after interaction so subsequent
    // operations find the UI in a clean state.
    await client.evaluate(`(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    })()`);
    await gaussianDelay(300, 75, 200, 500);

    if (outcome.kind === "none") {
      return {
        success: false as const,
        profileUrl: input.profileUrl,
        publicId,
        muted: false as const,
        reason: "mute_not_available",
        dryRun,
      };
    }

    if (outcome.kind === "unmute") {
      return {
        success: false as const,
        profileUrl: input.profileUrl,
        publicId,
        muted: false as const,
        reason: "already_muted",
        dryRun,
      };
    }

    await gaussianDelay(550, 75, 400, 700); // UI settle
    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell

    return {
      success: true as const,
      profileUrl: input.profileUrl,
      publicId,
      muted: !dryRun,
      hiddenName: outcome.name,
      dryRun,
    };
  } finally {
    client.disconnect();
  }
}
