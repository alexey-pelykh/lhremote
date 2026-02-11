import { readFileSync } from "node:fs";

import {
  type Account,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  errorMessage,
  InstanceService,
  LauncherService,
} from "@lhremote/core";

function parseUrls(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readUrlsFile(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  return content
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function handleImportPeopleFromUrls(
  campaignId: number,
  options: {
    urls?: string;
    urlsFile?: string;
    cdpPort?: number;
    json?: boolean;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;

  // Reject conflicting options
  if (options.urls && options.urlsFile) {
    process.stderr.write("Use only one of --urls or --urls-file.\n");
    process.exitCode = 1;
    return;
  }

  // Parse URLs from options
  let linkedInUrls: string[];
  if (options.urls) {
    linkedInUrls = parseUrls(options.urls);
  } else if (options.urlsFile) {
    try {
      linkedInUrls = readUrlsFile(options.urlsFile);
    } catch (error) {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
  } else {
    process.stderr.write("Either --urls or --urls-file is required.\n");
    process.exitCode = 1;
    return;
  }

  if (linkedInUrls.length === 0) {
    process.stderr.write("No URLs provided.\n");
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
    const message = errorMessage(error);
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

  // Connect and import people
  const instance = new InstanceService(instancePort);
  let db: DatabaseClient | null = null;

  try {
    await instance.connect();
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath);

    const campaignService = new CampaignService(instance, db);
    const result = await campaignService.importPeopleFromUrls(
      campaignId,
      linkedInUrls,
    );

    if (options.json) {
      const response = {
        success: true,
        campaignId,
        actionId: result.actionId,
        imported: result.successful,
        alreadyInQueue: result.alreadyInQueue,
        alreadyProcessed: result.alreadyProcessed,
        failed: result.failed,
      };
      process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Imported ${String(result.successful)} people into campaign ${String(campaignId)} action ${String(result.actionId)}.` +
          (result.alreadyInQueue > 0
            ? ` ${String(result.alreadyInQueue)} already in queue.`
            : "") +
          (result.alreadyProcessed > 0
            ? ` ${String(result.alreadyProcessed)} already processed.`
            : "") +
          (result.failed > 0
            ? ` ${String(result.failed)} failed.`
            : "") +
          "\n",
      );
    }
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(
        `Failed to import people: ${error.message}\n`,
      );
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  } finally {
    instance.disconnect();
    db?.close();
  }
}
