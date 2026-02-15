// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { CampaignStatistics, GetStatisticsOptions } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignStatisticsRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignStatisticsInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly actionId?: number | undefined;
  readonly maxErrors?: number | undefined;
}

export type CampaignStatisticsOutput = CampaignStatistics;

export async function campaignStatistics(
  input: CampaignStatisticsInput,
): Promise<CampaignStatisticsOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const statisticsRepo = new CampaignStatisticsRepository(db);
    const statsOptions: GetStatisticsOptions = {};
    if (input.actionId !== undefined) statsOptions.actionId = input.actionId;
    if (input.maxErrors !== undefined) statsOptions.maxErrors = input.maxErrors;
    return statisticsRepo.getStatistics(input.campaignId, statsOptions);
  });
}
