// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CampaignAction, CampaignActionConfig } from "../types/index.js";
import { ActionNotFoundError, CampaignRepository } from "../db/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

export interface CampaignCloneActionInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly actionId: number;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly actionSettingsOverrides?: Record<string, unknown> | undefined;
}

export type CampaignCloneActionOutput = CampaignAction;

export async function campaignCloneAction(
  input: CampaignCloneActionInput,
): Promise<CampaignCloneActionOutput> {
  const cdpPort = input.cdpPort;
  const accountId = await resolveAccount(cdpPort, buildCdpOptions(input));

  return withDatabase(accountId, ({ db }) => {
    const campaignRepo = new CampaignRepository(db);
    const campaign = campaignRepo.getCampaign(input.campaignId);
    const actions = campaignRepo.getCampaignActions(input.campaignId);
    const source = actions.find((action) => action.id === input.actionId);
    if (source === undefined) {
      throw new ActionNotFoundError(input.actionId, input.campaignId);
    }

    const actionConfig: CampaignActionConfig = {
      name: input.name ?? `${source.name} copy`,
      actionType: source.config.actionType,
      actionSettings: {
        ...source.config.actionSettings,
        ...(input.actionSettingsOverrides ?? {}),
      },
      coolDown: source.config.coolDown,
      maxActionResultsPerIteration: source.config.maxActionResultsPerIteration,
    };

    if (input.description !== undefined && input.description !== null) {
      actionConfig.description = input.description;
    } else if (source.description !== null) {
      actionConfig.description = source.description;
    }

    return campaignRepo.addAction(input.campaignId, actionConfig, campaign.liAccountId);
  }, { readOnly: false });
}
