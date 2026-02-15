// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { MessageStats } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { MessageRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export type ScrapeMessagingHistoryInput = ConnectionOptions;

export interface ScrapeMessagingHistoryOutput {
  readonly success: true;
  readonly actionType: "ScrapeMessagingHistory";
  readonly stats: MessageStats;
}

export async function scrapeMessagingHistory(
  input: ScrapeMessagingHistoryInput,
): Promise<ScrapeMessagingHistoryOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    await instance.executeAction("ScrapeMessagingHistory");

    const repo = new MessageRepository(db);
    const stats = repo.getMessageStats();

    return {
      success: true as const,
      actionType: "ScrapeMessagingHistory" as const,
      stats,
    };
  }, { instanceTimeout: 300_000 });
}
