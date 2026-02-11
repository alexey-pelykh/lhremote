import {
  type Account,
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  errorMessage,
  ExcludeListNotFoundError,
  LauncherService,
} from "@lhremote/core";

export async function handleCampaignExcludeList(
  campaignId: number,
  options: {
    actionId?: number;
    cdpPort?: number;
    json?: boolean;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;

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

  let db: DatabaseClient | null = null;

  try {
    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath);

    const repo = new CampaignRepository(db);
    const entries = repo.getExcludeList(campaignId, options.actionId);

    const level = options.actionId !== undefined ? "action" : "campaign";
    const targetLabel =
      options.actionId !== undefined
        ? `action ${String(options.actionId)} in campaign ${String(campaignId)}`
        : `campaign ${String(campaignId)}`;

    if (options.json) {
      const response = {
        campaignId,
        ...(options.actionId !== undefined
          ? { actionId: options.actionId }
          : {}),
        level,
        count: entries.length,
        personIds: entries.map((e) => e.personId),
      };
      process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Exclude list for ${targetLabel}: ${String(entries.length)} person(s)\n`,
      );
      if (entries.length > 0) {
        process.stdout.write(
          `Person IDs: ${entries.map((e) => String(e.personId)).join(", ")}\n`,
        );
      }
    }
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof ActionNotFoundError) {
      process.stderr.write(
        `Action ${String(options.actionId)} not found in campaign ${String(campaignId)}.\n`,
      );
    } else if (error instanceof ExcludeListNotFoundError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
