// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignExcludeListRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignExcludeAddInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly personIds: number[];
  readonly actionId?: number | undefined;
}

export interface CampaignExcludeAddOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly actionId?: number;
  readonly level: "campaign" | "action";
  readonly added: number;
  readonly alreadyExcluded: number;
}

export async function campaignExcludeAdd(
  input: CampaignExcludeAddInput,
): Promise<CampaignExcludeAddOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const excludeListRepo = new CampaignExcludeListRepository(db);
    const added = excludeListRepo.addToExcludeList(
      input.campaignId,
      input.personIds,
      input.actionId,
    );

    const level = input.actionId !== undefined ? "action" : "campaign";

    return {
      success: true as const,
      campaignId: input.campaignId,
      ...(input.actionId !== undefined ? { actionId: input.actionId } : {}),
      level: level as "campaign" | "action",
      added,
      alreadyExcluded: input.personIds.length - added,
    };
  }, { readOnly: false });
}
