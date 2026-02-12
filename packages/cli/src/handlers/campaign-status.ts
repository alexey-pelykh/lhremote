import {
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  errorMessage,
  InstanceNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-status} CLI command. */
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
    await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
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
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(
        `Failed to get campaign status: ${error.message}\n`,
      );
    } else if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}
