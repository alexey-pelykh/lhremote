// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { writeFileSync } from "node:fs";

import {
  CampaignNotFoundError,
  CampaignRepository,
  DEFAULT_CDP_PORT,
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
    cdpHost?: string;
    allowRemote?: boolean;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;
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
    accountId = await resolveAccount(cdpPort, {
      ...(options.cdpHost !== undefined && { host: options.cdpHost }),
      ...(options.allowRemote !== undefined && { allowRemote: options.allowRemote }),
    });
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
