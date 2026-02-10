import {
  CampaignRepository,
  type CampaignSummary,
  DatabaseClient,
  discoverAllDatabases,
  errorMessage,
} from "@lhremote/core";

export async function handleCampaignList(options: {
  includeArchived?: boolean;
  json?: boolean;
}): Promise<void> {
  const { includeArchived = false } = options;

  const databases = discoverAllDatabases();
  if (databases.size === 0) {
    process.stderr.write("No LinkedHelper databases found.\n");
    process.exitCode = 1;
    return;
  }

  const allCampaigns: CampaignSummary[] = [];

  for (const [, dbPath] of databases) {
    const db = new DatabaseClient(dbPath);
    try {
      const repo = new CampaignRepository(db);
      const campaigns = repo.listCampaigns({ includeArchived });
      allCampaigns.push(...campaigns);
    } catch (error) {
      const message = errorMessage(error);
      process.stderr.write(`Error in database at ${dbPath}: ${message}\n`);
      process.exitCode = 1;
      return;
    } finally {
      db.close();
    }
  }

  if (options.json) {
    const response = {
      campaigns: allCampaigns,
      total: allCampaigns.length,
    };
    process.stdout.write(JSON.stringify(response, null, 2) + "\n");
  } else {
    if (allCampaigns.length === 0) {
      process.stdout.write("No campaigns found.\n");
      return;
    }

    process.stdout.write(
      `Campaigns (${String(allCampaigns.length)} total):\n\n`,
    );

    for (const campaign of allCampaigns) {
      const parts: string[] = [`#${campaign.id}  ${campaign.name}`];
      parts.push(`[${campaign.state}]`);
      parts.push(`${String(campaign.actionCount)} actions`);
      if (campaign.description) {
        parts.push(campaign.description);
      }
      process.stdout.write(`${parts.join(" — ")}\n`);
    }
  }
}
