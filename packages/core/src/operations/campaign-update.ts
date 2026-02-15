// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { Campaign, CampaignUpdateConfig } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the campaign-update operation.
 */
export interface CampaignUpdateInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly updates: CampaignUpdateConfig;
}

/**
 * Output from the campaign-update operation.
 */
export type CampaignUpdateOutput = Campaign;

/**
 * Update a campaign's name and/or description.
 */
export async function campaignUpdate(
  input: CampaignUpdateInput,
): Promise<CampaignUpdateOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const campaignRepo = new CampaignRepository(db);
    return campaignRepo.updateCampaign(input.campaignId, input.updates);
  }, { readOnly: false });
}
