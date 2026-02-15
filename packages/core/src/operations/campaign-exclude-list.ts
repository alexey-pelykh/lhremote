// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignExcludeListRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignExcludeListInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly actionId?: number | undefined;
}

export interface CampaignExcludeListOutput {
  readonly campaignId: number;
  readonly actionId?: number;
  readonly level: "campaign" | "action";
  readonly count: number;
  readonly personIds: number[];
}

export async function campaignExcludeList(
  input: CampaignExcludeListInput,
): Promise<CampaignExcludeListOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const excludeListRepo = new CampaignExcludeListRepository(db);
    const entries = excludeListRepo.getExcludeList(input.campaignId, input.actionId);

    const level = input.actionId !== undefined ? "action" : "campaign";

    return {
      campaignId: input.campaignId,
      ...(input.actionId !== undefined ? { actionId: input.actionId } : {}),
      level: level as "campaign" | "action",
      count: entries.length,
      personIds: entries.map((e) => e.personId),
    };
  });
}
