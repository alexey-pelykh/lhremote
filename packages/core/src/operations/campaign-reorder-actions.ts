// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { CampaignAction } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignReorderActionsInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly actionIds: number[];
}

export interface CampaignReorderActionsOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly actions: CampaignAction[];
}

export async function campaignReorderActions(
  input: CampaignReorderActionsInput,
): Promise<CampaignReorderActionsOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const campaignService = new CampaignService(instance, db);
    const actions = await campaignService.reorderActions(input.campaignId, input.actionIds);

    return { success: true as const, campaignId: input.campaignId, actions };
  });
}
