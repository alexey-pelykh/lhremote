// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignStatisticsRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignRetryInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly personIds: number[];
}

export interface CampaignRetryOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly personsReset: number;
  readonly message: string;
}

export async function campaignRetry(
  input: CampaignRetryInput,
): Promise<CampaignRetryOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const statisticsRepo = new CampaignStatisticsRepository(db);
    statisticsRepo.resetForRerun(input.campaignId, input.personIds);

    return {
      success: true as const,
      campaignId: input.campaignId,
      personsReset: input.personIds.length,
      message: "Persons reset for retry. Use campaign-start to run the campaign.",
    };
  }, { readOnly: false });
}
