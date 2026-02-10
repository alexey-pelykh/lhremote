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

export async function handleCampaignStatus(
  campaignId: number,
  options: {
    includeResults?: boolean;
    limit?: number;
    cdpPort?: number;
    json?: boolean;
  },
): Promise<void> {
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

  // Connect and get status
  const instance = new InstanceService(instancePort);
  let db: DatabaseClient | null = null;

  try {
    await instance.connect();
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath);

    const campaignService = new CampaignService(instance, db);
    const status = await campaignService.getStatus(campaignId);

    const limit = options.limit ?? 20;

    if (options.json) {
      const response: Record<string, unknown> = { campaignId, ...status };
      if (options.includeResults) {
        const runResult = await campaignService.getResults(campaignId);
        response.results = runResult.results.slice(0, limit);
      }
      process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    } else {
      process.stdout.write(`Campaign #${String(campaignId)} Status\n`);
      process.stdout.write(`State: ${status.campaignState}\n`);
      process.stdout.write(`Paused: ${status.isPaused ? "yes" : "no"}\n`);
      process.stdout.write(`Runner: ${status.runnerState}\n`);

      if (status.actionCounts.length > 0) {
        process.stdout.write("\nAction Counts:\n");
        for (const ac of status.actionCounts) {
          process.stdout.write(
            `  Action #${String(ac.actionId)}: ${String(ac.queued)} queued, ${String(ac.processed)} processed, ${String(ac.successful)} successful, ${String(ac.failed)} failed\n`,
          );
        }
      }

      if (options.includeResults) {
        const runResult = await campaignService.getResults(campaignId);
        const results = runResult.results.slice(0, limit);
        if (results.length > 0) {
          process.stdout.write(`\nResults (${String(results.length)}):\n`);
          for (const r of results) {
            process.stdout.write(
              `  Person ${String(r.personId)}: result=${String(r.result)} (action version #${String(r.actionVersionId)})\n`,
            );
          }
        } else {
          process.stdout.write("\nNo results yet.\n");
        }
      }
    }
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(
        `Failed to get campaign status: ${error.message}\n`,
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
