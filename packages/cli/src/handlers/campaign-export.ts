import { writeFileSync } from "node:fs";

import {
  type Account,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  errorMessage,
  LauncherService,
  serializeCampaignJson,
  serializeCampaignYaml,
} from "@lhremote/core";

export async function handleCampaignExport(
  campaignId: number,
  options: {
    format?: string;
    output?: string;
    cdpPort?: number;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;
  const format = options.format ?? "yaml";

  if (format !== "yaml" && format !== "json") {
    process.stderr.write(
      `Unsupported format "${format}". Use "yaml" or "json".\n`,
    );
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

  // Open database and export campaign
  let db: DatabaseClient | null = null;

  try {
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath);

    const repo = new CampaignRepository(db);
    const campaign = repo.getCampaign(campaignId);
    const actions = repo.getCampaignActions(campaignId);

    const config =
      format === "json"
        ? serializeCampaignJson(campaign, actions)
        : serializeCampaignYaml(campaign, actions);

    if (options.output) {
      writeFileSync(options.output, config, "utf-8");
      process.stdout.write(
        `Campaign ${String(campaignId)} exported to ${options.output}\n`,
      );
    } else {
      process.stdout.write(config.endsWith("\n") ? config : `${config}\n`);
    }
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
