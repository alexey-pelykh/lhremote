// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignRemoveActionInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly actionId: number;
}

export interface CampaignRemoveActionOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly removedActionId: number;
}

export async function campaignRemoveAction(
  input: CampaignRemoveActionInput,
): Promise<CampaignRemoveActionOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const campaignService = new CampaignService(instance, db);
    await campaignService.removeAction(input.campaignId, input.actionId);

    return {
      success: true as const,
      campaignId: input.campaignId,
      removedActionId: input.actionId,
    };
  });
}
