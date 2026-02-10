import { readFileSync } from "node:fs";

import {
  type Account,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  CampaignTimeoutError,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  InstanceService,
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

export async function handleCampaignStart(
  campaignIdArg: string,
  options: {
    personIds?: string;
    personIdsFile?: string;
    cdpPort?: number;
    json?: boolean;
  },
): Promise<void> {
  const campaignId = Number(campaignIdArg);
  const cdpPort = options.cdpPort ?? 9222;

  // Parse person IDs from options
  let personIds: number[];
  if (options.personIds) {
    try {
      personIds = parsePersonIds(options.personIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
  } else if (options.personIdsFile) {
    try {
      personIds = readPersonIdsFile(options.personIdsFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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

  // Connect to launcher
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
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  } finally {
    launcher.disconnect();
  }

  // Discover instance
  const instancePort = await discoverInstancePort(cdpPort);
  if (instancePort === null) {
    process.stderr.write(
      "No LinkedHelper instance is running. Use start-instance first.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Connect and start campaign
  const instance = new InstanceService(instancePort);
  let db: DatabaseClient | null = null;

  try {
    await instance.connect();
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath);

    const campaignService = new CampaignService(instance, db);
    await campaignService.start(campaignId, personIds);

    if (options.json) {
      const response = {
        success: true,
        campaignId,
        personsQueued: personIds.length,
        message: "Campaign started. Use campaign-status to monitor progress.",
      };
      process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Campaign ${String(campaignId)} started with ${String(personIds.length)} persons queued.\n`,
      );
    }
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignTimeoutError) {
      process.stderr.write(
        `Campaign runner did not reach idle state: ${error.message}\n`,
      );
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(`Failed to start campaign: ${error.message}\n`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  } finally {
    instance.disconnect();
    db?.close();
  }
}
