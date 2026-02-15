// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignExcludeListRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CampaignExcludeRemoveInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly personIds: number[];
  readonly actionId?: number | undefined;
}

export interface CampaignExcludeRemoveOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly actionId?: number;
  readonly level: "campaign" | "action";
  readonly removed: number;
  readonly notInList: number;
}

export async function campaignExcludeRemove(
  input: CampaignExcludeRemoveInput,
): Promise<CampaignExcludeRemoveOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const excludeListRepo = new CampaignExcludeListRepository(db);
    const removed = excludeListRepo.removeFromExcludeList(
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
      removed,
      notInList: input.personIds.length - removed,
    };
  }, { readOnly: false });
}
