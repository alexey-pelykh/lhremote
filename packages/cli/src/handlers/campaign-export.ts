import { writeFileSync } from "node:fs";

import {
  CampaignNotFoundError,
  CampaignRepository,
  errorMessage,
  resolveAccount,
  serializeCampaignJson,
  serializeCampaignYaml,
  withDatabase,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-export} CLI command. */
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
