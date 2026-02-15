// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { Campaign, CampaignConfig } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the campaign-create operation.
 */
export interface CampaignCreateInput extends ConnectionOptions {
  readonly config: CampaignConfig;
}

/**
 * Output from the campaign-create operation.
 */
export type CampaignCreateOutput = Campaign;

/**
 * Create a new campaign from a parsed configuration.
 */
export async function campaignCreate(
  input: CampaignCreateInput,
): Promise<CampaignCreateOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const campaignService = new CampaignService(instance, db);
    return campaignService.create(input.config);
  });
}
