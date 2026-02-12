import {
  CampaignNotFoundError,
  CampaignRepository,
  errorMessage,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-get} CLI command. */
export async function handleCampaignGet(
  campaignId: number,
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
    await withDatabase(accountId, ({ db }) => {
      const repo = new CampaignRepository(db);
      const campaign = repo.getCampaign(campaignId);
      const actions = repo.getCampaignActions(campaignId);

      if (options.json) {
        process.stdout.write(
          JSON.stringify({ ...campaign, actions }, null, 2) + "\n",
        );
      } else {
        process.stdout.write(`Campaign #${campaign.id}: ${campaign.name}\n`);
        process.stdout.write(`State: ${campaign.state}\n`);
        process.stdout.write(`Paused: ${campaign.isPaused ? "yes" : "no"}\n`);
        process.stdout.write(
          `Archived: ${campaign.isArchived ? "yes" : "no"}\n`,
        );
        if (campaign.description) {
          process.stdout.write(`Description: ${campaign.description}\n`);
        }
        process.stdout.write(`Created: ${campaign.createdAt}\n`);

        if (actions.length > 0) {
          process.stdout.write(`\nActions (${String(actions.length)}):\n`);
          for (const action of actions) {
            process.stdout.write(
              `  #${action.id}  ${action.name} [${action.config.actionType}]\n`,
            );
          }
        }
      }
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}
