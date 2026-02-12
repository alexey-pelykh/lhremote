import { readFileSync } from "node:fs";

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  errorMessage,
  NoNextActionError,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

function parsePersonIds(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid person ID: "${s}"`);
      }
      return n;
    });
}

function readPersonIdsFile(filePath: string): number[] {
  const content = readFileSync(filePath, "utf-8");
  return content
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid person ID in file: "${s}"`);
      }
      return n;
    });
}

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-actions | campaign-move-next} CLI command. */
export async function handleCampaignMoveNext(
  campaignId: number,
  actionId: number,
  options: {
    personIds?: string;
    personIdsFile?: string;
    cdpPort?: number;
    json?: boolean;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;

  // Reject conflicting options
  if (options.personIds && options.personIdsFile) {
    process.stderr.write(
      "Use only one of --person-ids or --person-ids-file.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Parse person IDs from options
  let personIds: number[];
  if (options.personIds) {
    try {
      personIds = parsePersonIds(options.personIds);
    } catch (error) {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
  } else if (options.personIdsFile) {
    try {
      personIds = readPersonIdsFile(options.personIdsFile);
    } catch (error) {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
  } else {
    process.stderr.write(
      "Either --person-ids or --person-ids-file is required.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (personIds.length === 0) {
    process.stderr.write("No person IDs provided.\n");
    process.exitCode = 1;
    return;
  }

  let accountId: number;
  try {
    accountId = await resolveAccount(cdpPort);
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await withDatabase(accountId, ({ db }) => {
      const repo = new CampaignRepository(db);
      const { nextActionId } = repo.moveToNextAction(
        campaignId,
        actionId,
        personIds,
      );

      if (options.json) {
        const response = {
          success: true,
          campaignId,
          fromActionId: actionId,
          toActionId: nextActionId,
          personsMoved: personIds.length,
        };
        process.stdout.write(JSON.stringify(response, null, 2) + "\n");
      } else {
        process.stdout.write(
          `Campaign ${String(campaignId)}: ${String(personIds.length)} persons moved from action ${String(actionId)} to action ${String(nextActionId)}.\n`,
        );
      }
    }, { readOnly: false });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof ActionNotFoundError) {
      process.stderr.write(
        `Action ${String(actionId)} not found in campaign ${String(campaignId)}.\n`,
      );
    } else if (error instanceof NoNextActionError) {
      process.stderr.write(
        `Action ${String(actionId)} is the last action in campaign ${String(campaignId)}.\n`,
      );
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}
