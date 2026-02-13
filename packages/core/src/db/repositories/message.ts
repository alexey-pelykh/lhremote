// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type {
  Chat,
  ChatParticipant,
  ConversationMessages,
  ConversationThread,
  Message,
  MessageStats,
  MessageSummary,
} from "../../types/index.js";
import type { DatabaseClient } from "../client.js";
import { ChatNotFoundError } from "../errors.js";
import { escapeLike } from "../escape-like.js";

interface ChatRow {
  id: number;
  type: string;
  platform: string;
}

interface ChatParticipantRow {
  person_id: number;
  first_name: string;
  last_name: string | null;
}

interface LastMessageRow {
  message_text: string;
  send_at: string;
}

interface ChatListRow {
  chat_id: number;
  type: string;
  platform: string;
  last_message: string | null;
  last_message_at: string | null;
  message_count: number;
}

interface MessageRow {
  id: number;
  type: string;
  message_text: string;
  subject: string | null;
  send_at: string;
  attachments_count: number;
  sender_person_id: number;
  sender_first_name: string;
  sender_last_name: string | null;
}

interface MessageSinceRow {
  id: number;
  type: string;
  message_text: string;
  subject: string | null;
  send_at: string;
  attachments_count: number;
  sender_person_id: number;
  sender_first_name: string;
  sender_last_name: string | null;
  chat_id: number;
}

interface StatsRow {
  total_messages: number;
  total_chats: number;
  earliest_message: string | null;
  latest_message: string | null;
}

/**
 * Read-only repository for querying messaging data from
 * LinkedHelper's SQLite database.
 */
export class MessageRepository {
  private readonly stmtChatById;
  private readonly stmtChatParticipants;
  private readonly stmtChatMessageCount;
  private readonly stmtChatLastMessage;
  private readonly stmtListChats;
  private readonly stmtListChatsByPerson;
  private readonly stmtThreadMessages;
  private readonly stmtThreadMessagesBefore;
  private readonly stmtSearchMessages;
  private readonly stmtMessagesSince;
  private readonly stmtStats;

  constructor(client: DatabaseClient) {
    const { db } = client;

    this.stmtChatById = db.prepare(
      "SELECT id, type, platform FROM chats WHERE id = ?",
    );

    this.stmtChatParticipants = db.prepare(
      `SELECT cp.person_id, mp.first_name, mp.last_name
       FROM chat_participants cp
       JOIN person_mini_profile mp ON cp.person_id = mp.person_id
       WHERE cp.chat_id = ?`,
    );

    this.stmtChatMessageCount = db.prepare(
      `SELECT COUNT(DISTINCT pm.message_id) AS cnt
       FROM chat_participants cp
       JOIN participant_messages pm ON cp.id = pm.chat_participant_id
       WHERE cp.chat_id = ?`,
    );

    this.stmtChatLastMessage = db.prepare(
      `SELECT m.message_text, m.send_at
       FROM messages m
       JOIN participant_messages pm ON m.id = pm.message_id
       JOIN chat_participants cp ON pm.chat_participant_id = cp.id
       WHERE cp.chat_id = ?
       ORDER BY m.send_at DESC
       LIMIT 1`,
    );

    this.stmtListChats = db.prepare(
      `SELECT
         c.id AS chat_id,
         c.type,
         c.platform,
         latest_msg.message_text AS last_message,
         latest_msg.send_at AS last_message_at,
         COALESCE(msg_count.cnt, 0) AS message_count
       FROM chats c
       LEFT JOIN (
         SELECT cp2.chat_id,
                COUNT(DISTINCT pm2.message_id) AS cnt
         FROM chat_participants cp2
         JOIN participant_messages pm2 ON cp2.id = pm2.chat_participant_id
         GROUP BY cp2.chat_id
       ) msg_count ON c.id = msg_count.chat_id
       LEFT JOIN (
         SELECT cp3.chat_id,
                m3.message_text,
                m3.send_at,
                ROW_NUMBER() OVER (PARTITION BY cp3.chat_id ORDER BY m3.send_at DESC) AS rn
         FROM messages m3
         JOIN participant_messages pm3 ON m3.id = pm3.message_id
         JOIN chat_participants cp3 ON pm3.chat_participant_id = cp3.id
       ) latest_msg ON c.id = latest_msg.chat_id AND latest_msg.rn = 1
       ORDER BY latest_msg.send_at DESC
       LIMIT ? OFFSET ?`,
    );

    this.stmtListChatsByPerson = db.prepare(
      `SELECT
         c.id AS chat_id,
         c.type,
         c.platform,
         latest_msg.message_text AS last_message,
         latest_msg.send_at AS last_message_at,
         COALESCE(msg_count.cnt, 0) AS message_count
       FROM chats c
       JOIN chat_participants cp_filter ON c.id = cp_filter.chat_id
       LEFT JOIN (
         SELECT cp2.chat_id,
                COUNT(DISTINCT pm2.message_id) AS cnt
         FROM chat_participants cp2
         JOIN participant_messages pm2 ON cp2.id = pm2.chat_participant_id
         GROUP BY cp2.chat_id
       ) msg_count ON c.id = msg_count.chat_id
       LEFT JOIN (
         SELECT cp3.chat_id,
                m3.message_text,
                m3.send_at,
                ROW_NUMBER() OVER (PARTITION BY cp3.chat_id ORDER BY m3.send_at DESC) AS rn
         FROM messages m3
         JOIN participant_messages pm3 ON m3.id = pm3.message_id
         JOIN chat_participants cp3 ON pm3.chat_participant_id = cp3.id
       ) latest_msg ON c.id = latest_msg.chat_id AND latest_msg.rn = 1
       WHERE cp_filter.person_id = ?
       ORDER BY latest_msg.send_at DESC
       LIMIT ? OFFSET ?`,
    );

    this.stmtThreadMessages = db.prepare(
      `SELECT
         m.id,
         m.message_text,
         m.type,
         m.subject,
         m.send_at,
         m.attachments_count,
         cp.person_id AS sender_person_id,
         mp.first_name AS sender_first_name,
         mp.last_name AS sender_last_name
       FROM messages m
       JOIN participant_messages pm ON m.id = pm.message_id
       JOIN chat_participants cp ON pm.chat_participant_id = cp.id
       JOIN person_mini_profile mp ON cp.person_id = mp.person_id
       WHERE cp.chat_id = ?
       ORDER BY m.send_at ASC
       LIMIT ?`,
    );

    this.stmtThreadMessagesBefore = db.prepare(
      `SELECT
         m.id,
         m.message_text,
         m.type,
         m.subject,
         m.send_at,
         m.attachments_count,
         cp.person_id AS sender_person_id,
         mp.first_name AS sender_first_name,
         mp.last_name AS sender_last_name
       FROM messages m
       JOIN participant_messages pm ON m.id = pm.message_id
       JOIN chat_participants cp ON pm.chat_participant_id = cp.id
       JOIN person_mini_profile mp ON cp.person_id = mp.person_id
       WHERE cp.chat_id = ? AND m.send_at < ?
       ORDER BY m.send_at ASC
       LIMIT ?`,
    );

    this.stmtSearchMessages = db.prepare(
      `SELECT
         m.id,
         m.message_text,
         m.type,
         m.subject,
         m.send_at,
         m.attachments_count,
         cp.person_id AS sender_person_id,
         mp.first_name AS sender_first_name,
         mp.last_name AS sender_last_name
       FROM messages m
       JOIN participant_messages pm ON m.id = pm.message_id
       JOIN chat_participants cp ON pm.chat_participant_id = cp.id
       JOIN person_mini_profile mp ON cp.person_id = mp.person_id
       WHERE m.message_text LIKE ? ESCAPE '\\'
       ORDER BY m.send_at DESC
       LIMIT ?`,
    );

    this.stmtMessagesSince = db.prepare(
      `SELECT
         m.id,
         m.message_text,
         m.type,
         m.subject,
         m.send_at,
         m.attachments_count,
         cp.person_id AS sender_person_id,
         mp.first_name AS sender_first_name,
         mp.last_name AS sender_last_name,
         cp.chat_id
       FROM messages m
       JOIN participant_messages pm ON m.id = pm.message_id
       JOIN chat_participants cp ON pm.chat_participant_id = cp.id
       JOIN person_mini_profile mp ON cp.person_id = mp.person_id
       WHERE m.send_at > ?
       ORDER BY m.send_at ASC`,
    );

    this.stmtStats = db.prepare(
      `SELECT
         COUNT(DISTINCT m.id) AS total_messages,
         COUNT(DISTINCT c.id) AS total_chats,
         MIN(m.send_at) AS earliest_message,
         MAX(m.send_at) AS latest_message
       FROM chats c
       LEFT JOIN chat_participants cp ON c.id = cp.chat_id
       LEFT JOIN participant_messages pm ON cp.id = pm.chat_participant_id
       LEFT JOIN messages m ON pm.message_id = m.id`,
    );
  }

  /**
   * Lists conversations, optionally filtered by a participant's person ID.
   */
  listChats(options?: {
    personId?: number;
    limit?: number;
    offset?: number;
  }): Chat[] {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    let rows: ChatListRow[];
    if (options?.personId != null) {
      rows = this.stmtListChatsByPerson.all(
        options.personId,
        limit,
        offset,
      ) as unknown as ChatListRow[];
    } else {
      rows = this.stmtListChats.all(
        limit,
        offset,
      ) as unknown as ChatListRow[];
    }

    return rows.map((r) => this.assembleChatFromListRow(r));
  }

  /**
   * Gets the full conversation thread for a chat.
   *
   * @throws {ChatNotFoundError} if no chat exists with the given ID.
   */
  getThread(
    chatId: number,
    options?: { limit?: number; before?: string },
  ): ConversationThread {
    const chatRow = this.stmtChatById.get(chatId) as ChatRow | undefined;
    if (!chatRow) throw new ChatNotFoundError(chatId);

    const chat = this.assembleChat(chatRow);
    const limit = options?.limit ?? 100;

    let messageRows: MessageRow[];
    if (options?.before != null) {
      messageRows = this.stmtThreadMessagesBefore.all(
        chatId,
        options.before,
        limit,
      ) as unknown as MessageRow[];
    } else {
      messageRows = this.stmtThreadMessages.all(
        chatId,
        limit,
      ) as unknown as MessageRow[];
    }

    const messages: Message[] = messageRows.map((r) => mapMessageRow(r));

    return { chat, messages };
  }

  /**
   * Searches messages by text content using SQL LIKE.
   */
  searchMessages(
    query: string,
    options?: { limit?: number },
  ): Message[] {
    const limit = options?.limit ?? 50;
    const pattern = `%${escapeLike(query)}%`;

    const rows = this.stmtSearchMessages.all(
      pattern,
      limit,
    ) as unknown as MessageRow[];

    return rows.map((r) => mapMessageRow(r));
  }

  /**
   * Returns messages received after the given ISO timestamp, grouped
   * by conversation.  Each group identifies the sender (person) and
   * includes the list of new messages in chronological order.
   */
  getMessagesSince(since: string): ConversationMessages[] {
    const rows = this.stmtMessagesSince.all(
      since,
    ) as unknown as MessageSinceRow[];

    // Group by (chatId, senderPersonId)
    const groups = new Map<string, ConversationMessages>();
    for (const r of rows) {
      const key = `${String(r.chat_id)}:${String(r.sender_person_id)}`;
      let group = groups.get(key);
      if (!group) {
        const name = r.sender_last_name
          ? `${r.sender_first_name} ${r.sender_last_name}`
          : r.sender_first_name;
        group = {
          chatId: r.chat_id,
          personId: r.sender_person_id,
          personName: name,
          messages: [],
        };
        groups.set(key, group);
      }
      group.messages.push(mapMessageRow(r));
    }

    return [...groups.values()];
  }

  /**
   * Returns aggregate statistics across all messaging data.
   */
  getMessageStats(): MessageStats {
    const row = this.stmtStats.get() as unknown as StatsRow;

    return {
      totalMessages: row.total_messages,
      totalChats: row.total_chats,
      earliestMessage: row.earliest_message,
      latestMessage: row.latest_message,
    };
  }

  private assembleChatFromListRow(row: ChatListRow): Chat {
    const participants = this.getChatParticipants(row.chat_id);
    const lastMessage: MessageSummary | null =
      row.last_message != null && row.last_message_at != null
        ? { text: row.last_message, sendAt: row.last_message_at }
        : null;

    return {
      id: row.chat_id,
      type: row.type,
      platform: row.platform,
      participants,
      messageCount: row.message_count,
      lastMessage,
    };
  }

  private assembleChat(chatRow: ChatRow): Chat {
    const participants = this.getChatParticipants(chatRow.id);

    const countRow = this.stmtChatMessageCount.get(chatRow.id) as {
      cnt: number;
    };

    const lastMsgRow = this.stmtChatLastMessage.get(chatRow.id) as
      | LastMessageRow
      | undefined;
    const lastMessage: MessageSummary | null = lastMsgRow
      ? { text: lastMsgRow.message_text, sendAt: lastMsgRow.send_at }
      : null;

    return {
      id: chatRow.id,
      type: chatRow.type,
      platform: chatRow.platform,
      participants,
      messageCount: countRow.cnt,
      lastMessage,
    };
  }

  private getChatParticipants(chatId: number): ChatParticipant[] {
    const rows = this.stmtChatParticipants.all(
      chatId,
    ) as unknown as ChatParticipantRow[];

    return rows.map((r) => ({
      personId: r.person_id,
      firstName: r.first_name,
      lastName: r.last_name,
    }));
  }
}

function mapMessageRow(r: MessageRow): Message {
  return {
    id: r.id,
    type: r.type,
    text: r.message_text,
    subject: r.subject,
    sendAt: r.send_at,
    attachmentsCount: r.attachments_count,
    senderPersonId: r.sender_person_id,
    senderFirstName: r.sender_first_name,
    senderLastName: r.sender_last_name,
  };
}
