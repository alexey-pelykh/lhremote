// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { CampaignSummary } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the campaign-list operation.
 */
export interface CampaignListInput extends ConnectionOptions {
  readonly includeArchived?: boolean | undefined;
}

/**
 * Output from the campaign-list operation.
 */
export interface CampaignListOutput {
  readonly campaigns: CampaignSummary[];
  readonly total: number;
}

/**
 * List campaigns with optional archived filter.
 */
export async function campaignList(
  input: CampaignListInput,
): Promise<CampaignListOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const includeArchived = input.includeArchived ?? false;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const campaignRepo = new CampaignRepository(db);
    const campaigns = campaignRepo.listCampaigns({ includeArchived });

    return { campaigns, total: campaigns.length };
  });
}
