// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

/**
 * Input for the campaign-erase operation.
 */
export interface CampaignEraseInput extends ConnectionOptions {
  readonly campaignId: number;
}

/**
 * Output from the campaign-erase operation.
 */
export interface CampaignEraseOutput {
  readonly success: true;
  readonly campaignId: number;
}

/**
 * Permanently erase a campaign and all related data from the database.
 */
export async function campaignErase(
  input: CampaignEraseInput,
): Promise<CampaignEraseOutput> {
  const cdpPort = input.cdpPort;

  const accountId = await resolveAccount(cdpPort, buildCdpOptions(input));

  return withInstanceDatabase(cdpPort, accountId, ({ instance, db }) => {
    const campaignService = new CampaignService(instance, db);
    campaignService.hardDelete(input.campaignId);
    return { success: true as const, campaignId: input.campaignId };
  }, { db: { readOnly: false } });
}
