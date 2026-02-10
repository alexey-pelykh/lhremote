import {
  type Account,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  InstanceService,
  LauncherService,
} from "@lhremote/core";

export async function handleCampaignStop(
  campaignIdArg: string,
  options: {
    cdpPort?: number;
    json?: boolean;
  },
): Promise<void> {
  const campaignId = Number(campaignIdArg);
  const cdpPort = options.cdpPort ?? 9222;

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

  // Connect and stop campaign
  const instance = new InstanceService(instancePort);
  let db: DatabaseClient | null = null;

  try {
    await instance.connect();
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath);

    const campaignService = new CampaignService(instance, db);
    await campaignService.stop(campaignId);

    if (options.json) {
      const response = {
        success: true,
        campaignId,
        message: "Campaign paused",
      };
      process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    } else {
      process.stdout.write(`Campaign ${String(campaignId)} stopped.\n`);
    }
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(`Failed to stop campaign: ${error.message}\n`);
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
