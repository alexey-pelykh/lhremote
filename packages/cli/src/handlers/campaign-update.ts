import {
  type Account,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  errorMessage,
  LauncherService,
} from "@lhremote/core";

export async function handleCampaignUpdate(
  campaignId: number,
  options: {
    name?: string;
    description?: string;
    clearDescription?: boolean;
    cdpPort?: number;
    json?: boolean;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;

  // Validate that at least one field is provided
  if (
    options.name === undefined &&
    options.description === undefined &&
    !options.clearDescription
  ) {
    process.stderr.write(
      "At least one of --name, --description, or --clear-description is required.\n",
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

  // Open database (writable) and update campaign
  let db: DatabaseClient | null = null;

  try {
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath, { readOnly: false });

    const repo = new CampaignRepository(db);
    const updates: { name?: string; description?: string | null } = {};
    if (options.name !== undefined) updates.name = options.name;
    if (options.clearDescription) {
      updates.description = null;
    } else if (options.description !== undefined) {
      updates.description = options.description;
    }

    const campaign = repo.updateCampaign(campaignId, updates);

    if (options.json) {
      process.stdout.write(JSON.stringify(campaign, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Campaign updated: #${campaign.id} "${campaign.name}"\n`,
      );
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
