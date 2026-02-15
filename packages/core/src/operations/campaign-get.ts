// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { Campaign, CampaignAction } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the campaign-get operation.
 */
export interface CampaignGetInput extends ConnectionOptions {
  readonly campaignId: number;
}

/**
 * Output from the campaign-get operation.
 */
export interface CampaignGetOutput extends Campaign {
  readonly actions: CampaignAction[];
}

/**
 * Retrieve detailed information about a campaign including its actions.
 */
export async function campaignGet(
  input: CampaignGetInput,
): Promise<CampaignGetOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const campaignRepo = new CampaignRepository(db);
    const campaign = campaignRepo.getCampaign(input.campaignId);
    const actions = campaignRepo.getCampaignActions(input.campaignId);

    return { ...campaign, actions };
  });
}
