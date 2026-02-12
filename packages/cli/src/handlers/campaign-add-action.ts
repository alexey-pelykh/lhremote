import {
  CampaignNotFoundError,
  CampaignRepository,
  errorMessage,
  resolveAccount,
  withDatabase,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-actions | campaign-add-action} CLI command. */
export async function handleCampaignAddAction(
  campaignId: number,
  options: {
    name: string;
    actionType: string;
    description?: string;
    coolDown?: number;
    maxResults?: number;
    actionSettings?: string;
    cdpPort?: number;
    json?: boolean;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;

  // Parse action settings JSON if provided
  let parsedSettings: Record<string, unknown> = {};
  if (options.actionSettings !== undefined) {
    try {
      parsedSettings = JSON.parse(options.actionSettings) as Record<
        string,
        unknown
      >;
    } catch {
      process.stderr.write("Invalid JSON in --action-settings.\n");
      process.exitCode = 1;
      return;
    }
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
      const campaign = repo.getCampaign(campaignId);

      const actionConfig: import("@lhremote/core").CampaignActionConfig = {
        name: options.name,
        actionType: options.actionType,
        actionSettings: parsedSettings,
      };
      if (options.description !== undefined) {
        actionConfig.description = options.description;
      }
      if (options.coolDown !== undefined) {
        actionConfig.coolDown = options.coolDown;
      }
      if (options.maxResults !== undefined) {
        actionConfig.maxActionResultsPerIteration = options.maxResults;
      }

      const action = repo.addAction(
        campaignId,
        actionConfig,
        campaign.liAccountId,
      );

      if (options.json) {
        process.stdout.write(JSON.stringify(action, null, 2) + "\n");
      } else {
        process.stdout.write(
          `Action added: #${action.id} "${action.name}" (${action.config.actionType}) to campaign #${campaign.id}\n`,
        );
      }
    }, { readOnly: false });
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
