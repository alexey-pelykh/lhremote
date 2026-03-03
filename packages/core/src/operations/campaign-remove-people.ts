// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignRemovePeopleInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly personIds: number[];
}

export interface CampaignRemovePeopleOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly actionId: number;
  readonly removed: number;
}

export async function campaignRemovePeople(
  input: CampaignRemovePeopleInput,
): Promise<CampaignRemovePeopleOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const campaignService = new CampaignService(instance, db);
    const result = await campaignService.removePeople(
      input.campaignId,
      input.personIds,
    );

    return {
      success: true as const,
      campaignId: input.campaignId,
      actionId: result.actionId,
      removed: result.removed,
    };
  });
}
