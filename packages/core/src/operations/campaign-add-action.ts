// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CampaignAction, CampaignActionConfig } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignAddActionInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly name: string;
  readonly actionType: string;
  readonly description?: string | undefined;
  readonly coolDown?: number | undefined;
  readonly maxActionResultsPerIteration?: number | undefined;
  readonly actionSettings?: Record<string, unknown> | undefined;
}

export type CampaignAddActionOutput = CampaignAction;

export async function campaignAddAction(
  input: CampaignAddActionInput,
): Promise<CampaignAddActionOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const campaignRepo = new CampaignRepository(db);
    const campaign = campaignRepo.getCampaign(input.campaignId);

    const actionConfig: CampaignActionConfig = {
      name: input.name,
      actionType: input.actionType,
      actionSettings: input.actionSettings ?? {},
    };
    if (input.description !== undefined) {
      actionConfig.description = input.description;
    }
    if (input.coolDown !== undefined) {
      actionConfig.coolDown = input.coolDown;
    }
    if (input.maxActionResultsPerIteration !== undefined) {
      actionConfig.maxActionResultsPerIteration = input.maxActionResultsPerIteration;
    }

    return campaignRepo.addAction(input.campaignId, actionConfig, campaign.liAccountId);
  }, { readOnly: false });
}
