// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  DEFAULT_CDP_PORT,
  errorMessage,
  followPerson,
  type EphemeralActionResult,
  CampaignExecutionError,
  CampaignTimeoutError,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#follow-person | follow-person} CLI command. */
export async function handleFollowPerson(options: {
  personId?: number;
  url?: string;
  mode?: "follow" | "unfollow";
  skipIfUnfollowable?: boolean;
  keepCampaign?: boolean;
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  if ((options.personId == null) === (options.url == null)) {
    process.stderr.write("Exactly one of --person-id or --url must be provided.\n");
    process.exitCode = 1;
    return;
  }

  const mode = options.mode ?? "follow";
  process.stderr.write(`${mode === "follow" ? "Following" : "Unfollowing"} person...\n`);

  let result: EphemeralActionResult;
  try {
    result = await followPerson({
      personId: options.personId,
      url: options.url,
      mode: options.mode,
      skipIfUnfollowable: options.skipIfUnfollowable,
      keepCampaign: options.keepCampaign,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignExecutionError || error instanceof CampaignTimeoutError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`${errorMessage(error)}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stderr.write("Done.\n");

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const verb = mode === "follow" ? "Follow" : "Unfollow";
    process.stdout.write(`${verb} ${result.success ? "succeeded" : "failed"} (person #${String(result.personId)})\n`);
  }
}
