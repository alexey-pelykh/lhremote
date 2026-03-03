// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  campaignListPeople,
  type CampaignListPeopleOutput,
  type CampaignPersonState,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-list-people} CLI command. */
export async function handleCampaignListPeople(
  campaignId: number,
  options: {
    actionId?: number;
    status?: string;
    limit?: number;
    offset?: number;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  let result: CampaignListPeopleOutput;
  try {
    result = await campaignListPeople({
      campaignId,
      actionId: options.actionId,
      status: options.status as CampaignPersonState | undefined,
      limit: options.limit,
      offset: options.offset,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof ActionNotFoundError) {
      process.stderr.write(
        `Action ${String(options.actionId)} not found in campaign ${String(campaignId)}.\n`,
      );
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Campaign #${String(campaignId)} People (${String(result.total)} total)\n`,
    );

    if (result.people.length === 0) {
      process.stdout.write("  No people found.\n");
    } else {
      for (const person of result.people) {
        const name = person.lastName
          ? `${person.firstName} ${person.lastName}`
          : person.firstName;
        const publicId = person.publicId ? ` (${person.publicId})` : "";
        process.stdout.write(
          `  #${String(person.personId)} ${name}${publicId} — ${person.status} at action #${String(person.currentActionId)}\n`,
        );
      }

      if (result.total > result.offset + result.people.length) {
        process.stdout.write(
          `\nShowing ${String(result.offset + 1)}-${String(result.offset + result.people.length)} of ${String(result.total)}. Use --offset and --limit for pagination.\n`,
        );
      }
    }
  }
}
