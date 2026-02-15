// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { serializeCampaignJson, serializeCampaignYaml } from "../formats/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignExportInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly format: "yaml" | "json";
}

export interface CampaignExportOutput {
  readonly campaignId: number;
  readonly format: "yaml" | "json";
  readonly config: string;
}

export async function campaignExport(
  input: CampaignExportInput,
): Promise<CampaignExportOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const campaignRepo = new CampaignRepository(db);
    const campaign = campaignRepo.getCampaign(input.campaignId);
    const actions = campaignRepo.getCampaignActions(input.campaignId);

    const config =
      input.format === "json"
        ? serializeCampaignJson(campaign, actions)
        : serializeCampaignYaml(campaign, actions);

    return { campaignId: input.campaignId, format: input.format, config };
  });
}
