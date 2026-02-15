// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { Chat, ConversationThread, Message } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { MessageRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface QueryMessagesInput extends ConnectionOptions {
  readonly personId?: number | undefined;
  readonly chatId?: number | undefined;
  readonly search?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export type QueryMessagesOutput =
  | { readonly kind: "thread"; readonly thread: ConversationThread }
  | { readonly kind: "search"; readonly messages: Message[]; readonly total: number }
  | { readonly kind: "conversations"; readonly conversations: Chat[]; readonly total: number };

export async function queryMessages(
  input: QueryMessagesInput,
): Promise<QueryMessagesOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const repo = new MessageRepository(db);

    if (input.chatId != null) {
      const thread = repo.getThread(input.chatId, { limit });
      return { kind: "thread" as const, thread };
    }

    if (input.search != null) {
      const messages = repo.searchMessages(input.search, { limit });
      return { kind: "search" as const, messages, total: messages.length };
    }

    const conversations = repo.listChats({
      ...(input.personId != null && { personId: input.personId }),
      limit,
      offset,
    });
    return { kind: "conversations" as const, conversations, total: conversations.length };
  });
}
