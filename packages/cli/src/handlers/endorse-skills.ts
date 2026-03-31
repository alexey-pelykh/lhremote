// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  endorseSkills,
  type EphemeralActionResult,
  CampaignExecutionError,
  CampaignTimeoutError,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#endorse-skills | endorse-skills} CLI command. */
export async function handleEndorseSkills(options: {
  personId?: number;
  url?: string;
  skillNames?: string[];
  limit?: number;
  skipIfNotEndorsable?: boolean;
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

  process.stderr.write("Endorsing skills...\n");

  let result: EphemeralActionResult;
  try {
    result = await endorseSkills({
      personId: options.personId,
      url: options.url,
      skillNames: options.skillNames,
      limit: options.limit,
      skipIfNotEndorsable: options.skipIfNotEndorsable,
      keepCampaign: options.keepCampaign,
      cdpPort: options.cdpPort,
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
    process.stdout.write(`Endorse ${result.success ? "succeeded" : "failed"} (person #${String(result.personId)})\n`);
  }
}
