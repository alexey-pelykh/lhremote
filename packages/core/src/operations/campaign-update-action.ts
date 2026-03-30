// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CampaignAction, CampaignActionUpdateConfig } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

export interface CampaignUpdateActionInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly actionId: number;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly coolDown?: number | undefined;
  readonly maxActionResultsPerIteration?: number | undefined;
  readonly actionSettings?: Record<string, unknown> | undefined;
}

export type CampaignUpdateActionOutput = CampaignAction;

export async function campaignUpdateAction(
  input: CampaignUpdateActionInput,
): Promise<CampaignUpdateActionOutput> {
  const cdpPort = input.cdpPort;

  const accountId = await resolveAccount(cdpPort, buildCdpOptions(input));

  return withDatabase(accountId, ({ db }) => {
    const campaignRepo = new CampaignRepository(db);

    const updates: CampaignActionUpdateConfig = {};
    if (input.name !== undefined) {
      updates.name = input.name;
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }
    if (input.coolDown !== undefined) {
      updates.coolDown = input.coolDown;
    }
    if (input.maxActionResultsPerIteration !== undefined) {
      updates.maxActionResultsPerIteration = input.maxActionResultsPerIteration;
    }
    if (input.actionSettings !== undefined) {
      updates.actionSettings = input.actionSettings;
    }

    return campaignRepo.updateAction(input.campaignId, input.actionId, updates);
  }, { readOnly: false });
}
