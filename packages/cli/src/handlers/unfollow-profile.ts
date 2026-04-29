// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  unfollowProfile,
  type UnfollowProfileOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#unfollow-profile | unfollow-profile} CLI command. */
export async function handleUnfollowProfile(
  profileUrl: string,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    dryRun?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: UnfollowProfileOutput;
  try {
    result = await unfollowProfile({
      profileUrl,
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
      dryRun: options.dryRun,
    });
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  const targetLabel = result.targetKind === "company" ? "Company" : "Profile";
  const pageLabel =
    result.targetKind === "company" ? "company page" : "profile page";

  if (result.priorState === "not_following") {
    process.stdout.write(
      `${targetLabel} "${result.publicId}" was not being followed (no action taken)\n`,
    );
    return;
  }

  if (result.priorState === "unknown") {
    // "private/blocked" describes member profiles; companies are
    // "restricted" rather than "private", so use kind-specific wording
    // so the message accurately describes why the page may have hidden
    // the Follow / Following toggle.
    const accessReason =
      result.targetKind === "company"
        ? "restricted/unavailable company"
        : "private/blocked profile";
    process.stdout.write(
      `Could not detect follow state for "${result.publicId}" ` +
        `(${accessReason}, or LinkedIn DOM changed — no action taken)\n`,
    );
    return;
  }

  const name = result.unfollowedName ?? result.publicId;
  if (result.dryRun) {
    process.stdout.write(
      `[dry-run] Would unfollow "${name}" from the ${pageLabel}\n` +
        `  ${targetLabel}: ${result.profileUrl}\n`,
    );
  } else {
    process.stdout.write(
      `Unfollowed "${name}" from the ${pageLabel}\n` +
        `  ${targetLabel}: ${result.profileUrl}\n`,
    );
  }
}
