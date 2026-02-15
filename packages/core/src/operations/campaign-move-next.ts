// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignMoveNextInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly actionId: number;
  readonly personIds: number[];
}

export interface CampaignMoveNextOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly fromActionId: number;
  readonly toActionId: number;
  readonly personsMoved: number;
}

export async function campaignMoveNext(
  input: CampaignMoveNextInput,
): Promise<CampaignMoveNextOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const campaignRepo = new CampaignRepository(db);
    const { nextActionId } = campaignRepo.moveToNextAction(
      input.campaignId,
      input.actionId,
      input.personIds,
    );

    return {
      success: true as const,
      campaignId: input.campaignId,
      fromActionId: input.actionId,
      toActionId: nextActionId,
      personsMoved: input.personIds.length,
    };
  }, { readOnly: false });
}
