import {
  ActionNotFoundError,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  errorMessage,
  InstanceNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-actions | campaign-remove-action} CLI command. */
export async function handleCampaignRemoveAction(
  campaignId: number,
  actionId: number,
  options: {
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
      await campaignService.removeAction(campaignId, actionId);

      if (options.json) {
        const response = {
          success: true,
          campaignId,
          removedActionId: actionId,
        };
        process.stdout.write(JSON.stringify(response, null, 2) + "\n");
      } else {
        process.stdout.write(
          `Action ${String(actionId)} removed from campaign ${String(campaignId)}.\n`,
        );
      }
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof ActionNotFoundError) {
      process.stderr.write(
        `Action ${String(actionId)} not found in campaign ${String(campaignId)}.\n`,
      );
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(`Failed to remove action: ${error.message}\n`);
    } else if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}
