// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the campaign-delete operation.
 */
export interface CampaignDeleteInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly hard?: boolean | undefined;
}

/**
 * Output from the campaign-delete operation.
 */
export interface CampaignDeleteOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly action: "archived" | "hard-deleted";
}

/**
 * Delete a campaign.
 *
 * By default, archives the campaign (soft delete). When `hard` is true,
 * permanently removes the campaign and all related rows from the database.
 */
export async function campaignDelete(
  input: CampaignDeleteInput,
): Promise<CampaignDeleteOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const campaignService = new CampaignService(instance, db);

    if (input.hard) {
      campaignService.hardDelete(input.campaignId);
      return { success: true as const, campaignId: input.campaignId, action: "hard-deleted" as const };
    }

    await campaignService.delete(input.campaignId);
    return { success: true as const, campaignId: input.campaignId, action: "archived" as const };
  }, input.hard ? { db: { readOnly: false } } : undefined);
}
