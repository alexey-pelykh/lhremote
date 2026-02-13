// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { CampaignActionResult, CampaignStatus } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the campaign-status operation.
 */
export interface CampaignStatusInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly includeResults?: boolean | undefined;
  readonly limit?: number | undefined;
}

/**
 * Output from the campaign-status operation.
 */
export interface CampaignStatusOutput extends CampaignStatus {
  readonly campaignId: number;
  readonly results?: CampaignActionResult[];
}

/**
 * Retrieve the execution status of a campaign, optionally including
 * action results.
 *
 * This is the shared business logic used by both the CLI handler and
 * the MCP tool.
 */
export async function campaignStatus(
  input: CampaignStatusInput,
): Promise<CampaignStatusOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const limit = input.limit ?? 20;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const campaignService = new CampaignService(instance, db);
    const status = await campaignService.getStatus(input.campaignId);

    const output: CampaignStatusOutput = { campaignId: input.campaignId, ...status };

    if (input.includeResults) {
      const runResult = await campaignService.getResults(input.campaignId);
      return { ...output, results: runResult.results.slice(0, limit) };
    }

    return output;
  });
}
