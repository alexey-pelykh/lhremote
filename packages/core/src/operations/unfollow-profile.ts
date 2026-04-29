// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { resolveInstancePort } from "../cdp/index.js";
import { retryInteraction, waitForElement } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { gaussianDelay } from "../utils/delay.js";
import {
  extractFollowableTarget,
  navigateToCompany,
  navigateToProfile,
  type FollowableTarget,
} from "./navigate-to-profile.js";
import type { ConnectionOptions } from "./types.js";

/** aria-label prefix of a "Following {Name}" toggle button (profile or company). */
const PROFILE_FOLLOWING_ARIA_PREFIX = "Following ";

/** CSS selector for a "Following {Name}" button (when actively following). */
const PROFILE_FOLLOWING_BUTTON_SELECTOR = `main button[aria-label^="${PROFILE_FOLLOWING_ARIA_PREFIX}"]`;

/** CSS selector for a "Follow {Name}" button (when not following). */
const PROFILE_FOLLOW_BUTTON_SELECTOR = 'main button[aria-label^="Follow "]';

/** Prefix of the "Unfollow {Name}" confirmation dialog button. */
const UNFOLLOW_DIALOG_BUTTON_PREFIX = "Unfollow ";

/**
 * Prior follow state inferred from the page's primary action button
 * (profile or company).
 *
 * - `following`     — The page showed a "Following" toggle (we proceed to unfollow).
 * - `not_following` — The page showed a "Follow" toggle (nothing to do).
 * - `unknown`       — Neither toggle was visible within the timeout.
 */
export type UnfollowProfilePriorState = "following" | "not_following" | "unknown";

export interface UnfollowProfileInput extends ConnectionOptions {
  /**
   * LinkedIn profile or company URL.  Both member profiles
   * (`https://www.linkedin.com/in/{publicId}/`) and organization pages
   * (`https://www.linkedin.com/company/{slug}/`) are accepted; the
   * Following toggle behaves the same way on both surfaces, so a single
   * unfollow path covers both.
   */
  readonly profileUrl: string;
  /** Optional humanized mouse for natural cursor movement and clicks. */
  readonly mouse?: HumanizedMouse | null | undefined;
  /**
   * When true, locate the page and detect the follow state but do not
   * click Unfollow.  Useful to probe the state of a profile or company
   * without mutating it.
   */
  readonly dryRun?: boolean | undefined;
}

export interface UnfollowProfileOutput {
  readonly success: true;
  readonly profileUrl: string;
  /**
   * URL slug extracted from `profileUrl` — the LinkedIn public ID for
   * `/in/{publicId}/` URLs and the company slug for `/company/{slug}/`
   * URLs.  Use {@link UnfollowProfileOutput.targetKind} to discriminate.
   */
  readonly publicId: string;
  /**
   * Kind of followable target unfollowed.  `"profile"` for member
   * profiles, `"company"` for organization pages.
   */
  readonly targetKind: FollowableTarget["kind"];
  /**
   * State of the follow toggle before this call.  When `"not_following"`,
   * no Unfollow click was performed and `unfollowedName` is `null`.
   */
  readonly priorState: UnfollowProfilePriorState;
  /**
   * Name extracted from the Following button's aria-label (e.g. `"Jane Doe"`
   * from `aria-label="Following Jane Doe"`, or `"Acme Inc"` from
   * `aria-label="Following Acme Inc"`).  `null` when the target was not
   * being followed or the name could not be extracted.
   */
  readonly unfollowedName: string | null;
  readonly dryRun: boolean;
}

/**
 * Unfollow a LinkedIn member profile or organization page by navigating
 * to it and clicking the Following → Unfollow toggle.
 *
 * Both `/in/{publicId}/` and `/company/{slug}/` URLs are accepted —
 * LinkedIn renders the same Follow / Following toggle on both surfaces,
 * and the same aria-label-anchored detection works for both.  Use this
 * over {@link unfollowFromFeed} for bulk feed-hygiene workflows where a
 * list of authors (people or organizations) must be processed without
 * per-target feed fetching, including org-level MUTE escalation when the
 * organization isn't currently surfaced in the feed.
 *
 * The operation:
 * 1. Parses {@link UnfollowProfileInput.profileUrl} into a profile or
 *    company target and navigates to the corresponding page.
 * 2. Detects the follow state via aria-label anchors on the primary
 *    action button.
 * 3. If the target is being followed, clicks the "Following" button,
 *    waits for the confirmation dialog, and clicks "Unfollow {Name}".
 * 4. If the target is not being followed, returns immediately with
 *    `priorState: "not_following"` and no click performed.
 *
 * @param input - Profile or company URL and CDP connection parameters.
 * @returns Confirmation including the detected prior state, extracted
 *   name, and which kind of target (`"profile"` or `"company"`) was
 *   processed.
 */
export async function unfollowProfile(
  input: UnfollowProfileInput,
): Promise<UnfollowProfileOutput> {
  const target = extractFollowableTarget(input.profileUrl);
  // `targetSlug` is the URL segment regardless of target kind — the
  // member public ID for /in/ URLs or the company slug for /company/
  // URLs.  Used in error messages and on the output's `publicId` field
  // (which is documented to alias both kinds; see UnfollowProfileOutput).
  const targetSlug =
    target.kind === "profile" ? target.publicId : target.slug;

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

    if (target.kind === "profile") {
      await navigateToProfile(client, target.publicId, mouse);
    } else {
      await navigateToCompany(client, target.slug, mouse);
    }

    // Detect the current follow state by inspecting the primary action
    // button on the page (profile or company).  LinkedIn renders exactly
    // one of:
    //   - `Following {Name}` — currently following, click opens confirm dialog
    //   - `Follow {Name}`    — not following, nothing to do
    const detection = await client.evaluate<{
      state: "following" | "not_following" | "unknown";
      name: string | null;
    }>(`(() => {
      const followingPrefix = ${JSON.stringify(PROFILE_FOLLOWING_ARIA_PREFIX)};
      const followingBtn = document.querySelector(
        ${JSON.stringify(PROFILE_FOLLOWING_BUTTON_SELECTOR)}
      );
      if (followingBtn) {
        const label = followingBtn.getAttribute("aria-label") || "";
        const name = label.startsWith(followingPrefix)
          ? label.slice(followingPrefix.length).trim() || null
          : null;
        return { state: "following", name };
      }
      const followBtn = document.querySelector(
        ${JSON.stringify(PROFILE_FOLLOW_BUTTON_SELECTOR)}
      );
      if (followBtn) return { state: "not_following", name: null };
      return { state: "unknown", name: null };
    })()`);

    if (detection.state === "not_following") {
      await gaussianDelay(550, 75, 400, 700);
      return {
        success: true as const,
        profileUrl: input.profileUrl,
        publicId: targetSlug,
        targetKind: target.kind,
        priorState: "not_following",
        unfollowedName: null,
        dryRun,
      };
    }

    if (detection.state === "unknown") {
      // Neither Follow nor Following button visible: private profile,
      // blocked, or layout change.  Return structured result instead of
      // throwing so bulk workflows can skip and continue; callers that
      // require strict detection can inspect `priorState`.
      await gaussianDelay(550, 75, 400, 700);
      return {
        success: true as const,
        profileUrl: input.profileUrl,
        publicId: targetSlug,
        targetKind: target.kind,
        priorState: "unknown",
        unfollowedName: null,
        dryRun,
      };
    }

    // The page is currently being followed.  Clicking the Following button
    // opens a confirmation dialog on most LinkedIn variants; on some, it
    // unfollows immediately.  Retry the interaction to tolerate transient
    // dialog-render delays.
    const confirmedName = await retryInteraction(async () => {
      // Wait for the Following button and click it.
      await waitForElement(
        client,
        PROFILE_FOLLOWING_BUTTON_SELECTOR,
        { timeout: 10_000 },
        mouse,
      );

      const clicked = await client.evaluate<boolean>(`(() => {
        const btn = document.querySelector(
          ${JSON.stringify(PROFILE_FOLLOWING_BUTTON_SELECTOR)}
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()`);

      if (!clicked) {
        throw new Error(
          `Failed to click Following button for "${targetSlug}".`,
        );
      }

      await gaussianDelay(700, 100, 500, 900);

      // Search for an "Unfollow {Name}" confirmation button in any open
      // dialog.  If found, click it (unless dryRun).
      const name = await client.evaluate<string | null>(`(() => {
        const dryRun = ${String(dryRun)};
        const dialogs = document.querySelectorAll('[role="dialog"], [role="menu"]');
        const prefix = ${JSON.stringify(UNFOLLOW_DIALOG_BUTTON_PREFIX)};
        for (const dialog of dialogs) {
          for (const btn of dialog.querySelectorAll('button, [role="menuitem"]')) {
            const text = (btn.textContent || "").trim();
            if (text.startsWith(prefix)) {
              const name = text.slice(prefix.length).trim();
              if (!name) continue;
              if (!dryRun) btn.click();
              return name;
            }
          }
        }
        return null;
      })()`);

      if (name !== null) {
        return name;
      }

      // No confirmation dialog — the Following button may have toggled
      // directly to a Follow button (synchronous unfollow).  Verify by
      // re-reading the action button state.
      await gaussianDelay(400, 75, 300, 600);
      const afterClick = await client.evaluate<boolean>(`(() => {
        return document.querySelector(
          ${JSON.stringify(PROFILE_FOLLOW_BUTTON_SELECTOR)}
        ) !== null;
      })()`);
      if (afterClick) {
        // Synchronous unfollow succeeded.  Fall back to the name
        // captured during initial detection.
        return detection.name ?? "";
      }

      // Dismiss any open dialog before retrying.
      await client.evaluate(`(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      })()`);

      throw new Error(
        `Unfollow confirmation did not appear for "${targetSlug}". ` +
          "LinkedIn's DOM may have changed or the page did not fully load.",
      );
    }, 3);

    if (dryRun) {
      // In dry-run mode, dismiss any dialog we may have opened so the
      // UI is clean for subsequent operations.
      await client.evaluate(`(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      })()`);
      await gaussianDelay(300, 75, 200, 500);
    }

    await gaussianDelay(550, 75, 400, 700); // UI settle
    await gaussianDelay(1_500, 500, 700, 3_500); // Post-action dwell

    return {
      success: true as const,
      profileUrl: input.profileUrl,
      publicId: targetSlug,
      targetKind: target.kind,
      priorState: "following",
      unfollowedName: confirmedName.length > 0 ? confirmedName : null,
      dryRun,
    };
  } finally {
    client.disconnect();
  }
}
