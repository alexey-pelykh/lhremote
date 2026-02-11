import { readFileSync } from "node:fs";

import {
  type Account,
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  errorMessage,
  ExcludeListNotFoundError,
  LauncherService,
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

export async function handleCampaignExcludeRemove(
  campaignId: number,
  options: {
    personIds?: string;
    personIdsFile?: string;
    actionId?: number;
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

  // Connect to launcher to find account
  const launcher = new LauncherService(cdpPort);
  let accountId: number;

  try {
    await launcher.connect();
    const accounts = await launcher.listAccounts();
    if (accounts.length === 0) {
      process.stderr.write("No accounts found.\n");
      process.exitCode = 1;
      return;
    }
    if (accounts.length > 1) {
      process.stderr.write(
        "Multiple accounts found. Cannot determine which instance to use.\n",
      );
      process.exitCode = 1;
      return;
    }
    accountId = (accounts[0] as Account).id;
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  } finally {
    launcher.disconnect();
  }

  let db: DatabaseClient | null = null;

  try {
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath, { readOnly: false });

    const repo = new CampaignRepository(db);
    const removed = repo.removeFromExcludeList(
      campaignId,
      personIds,
      options.actionId,
    );

    const level = options.actionId !== undefined ? "action" : "campaign";
    const targetLabel =
      options.actionId !== undefined
        ? `action ${String(options.actionId)} in campaign ${String(campaignId)}`
        : `campaign ${String(campaignId)}`;

    if (options.json) {
      const response = {
        success: true,
        campaignId,
        ...(options.actionId !== undefined
          ? { actionId: options.actionId }
          : {}),
        level,
        removed,
        notInList: personIds.length - removed,
      };
      process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Removed ${String(removed)} person(s) from exclude list for ${targetLabel}.\n`,
      );
      if (personIds.length - removed > 0) {
        process.stdout.write(
          `${String(personIds.length - removed)} person(s) were not in the exclude list.\n`,
        );
      }
    }
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof ActionNotFoundError) {
      process.stderr.write(
        `Action ${String(options.actionId)} not found in campaign ${String(campaignId)}.\n`,
      );
    } else if (error instanceof ExcludeListNotFoundError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
