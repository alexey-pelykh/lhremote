// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ConversationMessages } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { MessageRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface CheckRepliesInput extends ConnectionOptions {
  readonly since?: string | undefined;
}

export interface CheckRepliesOutput {
  readonly newMessages: ConversationMessages[];
  readonly totalNew: number;
  readonly checkedAt: string;
}

export async function checkReplies(
  input: CheckRepliesInput,
): Promise<CheckRepliesOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const cutoff =
    input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    await instance.executeAction("CheckForReplies");

    const repo = new MessageRepository(db);
    const conversations = repo.getMessagesSince(cutoff);
    const totalNew = conversations.reduce(
      (sum, c) => sum + c.messages.length,
      0,
    );

    return {
      newMessages: conversations,
      totalNew,
      checkedAt: new Date().toISOString(),
    };
  }, { instanceTimeout: 120_000 });
}
