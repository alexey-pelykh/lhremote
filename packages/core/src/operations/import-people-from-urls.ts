// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface ImportPeopleFromUrlsInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly linkedInUrls: string[];
}

export interface ImportPeopleFromUrlsOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly actionId: number;
  readonly imported: number;
  readonly alreadyInQueue: number;
  readonly alreadyProcessed: number;
  readonly failed: number;
}

export async function importPeopleFromUrls(
  input: ImportPeopleFromUrlsInput,
): Promise<ImportPeopleFromUrlsOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const campaignService = new CampaignService(instance, db);
    const result = await campaignService.importPeopleFromUrls(
      input.campaignId,
      input.linkedInUrls,
    );

    return {
      success: true as const,
      campaignId: input.campaignId,
      actionId: result.actionId,
      imported: result.successful,
      alreadyInQueue: result.alreadyInQueue,
      alreadyProcessed: result.alreadyProcessed,
      failed: result.failed,
    };
  });
}
