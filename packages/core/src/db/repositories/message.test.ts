// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseClient } from "../client.js";
import { ChatNotFoundError } from "../errors.js";
import { openFixture } from "../testing/open-fixture.js";
import { MessageRepository } from "./message.js";

describe("MessageRepository", () => {
  let db: DatabaseSync;
  let client: DatabaseClient;
  let repo: MessageRepository;

  beforeEach(() => {
    db = openFixture();
    client = { db } as DatabaseClient;
    repo = new MessageRepository(client);
  });

  afterEach(() => {
    db.close();
  });

  describe("listChats", () => {
    it("returns all chats ordered by latest message", () => {
      const chats = repo.listChats();

      expect(chats).toHaveLength(4);
      // Chat 4 has latest message (2025-01-14), then Chat 3 (2025-01-13), then Chat 2 (2025-01-12), then Chat 1 (2025-01-11)
      expect(chats.map((c) => c.id)).toEqual([4, 3, 2, 1]);
    });

    it("includes participants for each chat", () => {
      const chats = repo.listChats();
      const chat1 = chats.find((c) => c.id === 1);
      expect(chat1).toBeDefined();
      expect(chat1?.participants).toHaveLength(2);
      expect(chat1?.participants).toContainEqual({
        personId: 1,
        firstName: "Ada",
        lastName: "Lovelace",
      });
      expect(chat1?.participants).toContainEqual({
        personId: 3,
        firstName: "Grace",
        lastName: "Hopper",
      });
    });

    it("includes last message summary", () => {
      const chats = repo.listChats();
      const chat1 = chats.find((c) => c.id === 1);
      expect(chat1).toBeDefined();
      expect(chat1?.lastMessage).toEqual({
        text: "Let us schedule a meeting next week.",
        sendAt: "2025-01-11T14:30:00.000Z",
      });
    });

    it("includes message count", () => {
      const chats = repo.listChats();
      const chat1 = chats.find((c) => c.id === 1);
      expect(chat1).toBeDefined();
      expect(chat1?.messageCount).toBe(3);
    });

    it("filters by personId", () => {
      // Person 2 (Charlie) is in chat 2, chat 3, and chat 4
      const chats = repo.listChats({ personId: 2 });

      expect(chats).toHaveLength(3);
      const chatIds = chats.map((c) => c.id);
      expect(chatIds).toContain(2);
      expect(chatIds).toContain(3);
      expect(chatIds).toContain(4);
    });

    it("respects limit parameter", () => {
      const chats = repo.listChats({ limit: 1 });

      expect(chats).toHaveLength(1);
    });

    it("respects offset parameter", () => {
      const chats = repo.listChats({ limit: 1, offset: 1 });

      expect(chats).toHaveLength(1);
      expect(chats.map((c) => c.id)).toEqual([3]);
    });
  });

  describe("getThread", () => {
    it("returns messages in chronological order", () => {
      const thread = repo.getThread(1);

      expect(thread.messages).toHaveLength(3);
      expect(thread.messages.map((m) => m.text)).toEqual([
        "Hello Grace, I enjoyed your talk on compilers.",
        "Thank you Ada! Would love to discuss analytical engines sometime.",
        "Let us schedule a meeting next week.",
      ]);
    });

    it("includes sender information", () => {
      const thread = repo.getThread(1);
      const adaMsg = thread.messages.find((m) => m.senderPersonId === 1);
      const graceMsg = thread.messages.find((m) => m.senderPersonId === 3);

      expect(adaMsg).toBeDefined();
      expect(adaMsg?.senderFirstName).toBe("Ada");
      expect(adaMsg?.senderLastName).toBe("Lovelace");

      expect(graceMsg).toBeDefined();
      expect(graceMsg?.senderFirstName).toBe("Grace");
    });

    it("includes chat metadata", () => {
      const thread = repo.getThread(1);

      expect(thread.chat.id).toBe(1);
      expect(thread.chat.type).toBe("MEMBER_TO_MEMBER");
      expect(thread.chat.platform).toBe("LINKEDIN");
      expect(thread.chat.participants).toHaveLength(2);
      expect(thread.chat.messageCount).toBe(3);
    });

    it("includes attachments count", () => {
      const thread = repo.getThread(1);
      const msgWithAttachment = thread.messages.find(
        (m) => m.text === "Let us schedule a meeting next week.",
      );

      expect(msgWithAttachment).toBeDefined();
      expect(msgWithAttachment?.attachmentsCount).toBe(1);
    });

    it("includes subject for InMail-style messages", () => {
      const thread = repo.getThread(2);
      const msg = thread.messages.find(
        (m) => m.text === "Hi Charlie, we have an opening on our team.",
      );

      expect(msg).toBeDefined();
      expect(msg?.subject).toBe("Job Opportunity");
    });

    it("respects limit parameter", () => {
      const thread = repo.getThread(1, { limit: 2 });

      expect(thread.messages).toHaveLength(2);
    });

    it("supports before parameter for pagination", () => {
      const thread = repo.getThread(1, {
        before: "2025-01-11T00:00:00.000Z",
      });

      expect(thread.messages).toHaveLength(2);
      expect(thread.messages.map((m) => m.text)).toEqual([
        "Hello Grace, I enjoyed your talk on compilers.",
        "Thank you Ada! Would love to discuss analytical engines sometime.",
      ]);
    });

    it("throws ChatNotFoundError for a missing chat", () => {
      expect(() => repo.getThread(999)).toThrow(ChatNotFoundError);
      expect(() => repo.getThread(999)).toThrow("Chat not found for id 999");
    });
  });

  describe("searchMessages", () => {
    it("finds messages containing search text", () => {
      const results = repo.searchMessages("compiler");

      expect(results).toHaveLength(2);
      // Results are ordered by send_at DESC
      expect(results.map((m) => m.text)).toEqual([
        "Charlie, have you tried the new COBOL compiler?",
        "Hello Grace, I enjoyed your talk on compilers.",
      ]);
    });

    it("returns empty array for no matches", () => {
      const results = repo.searchMessages("nonexistent-query-xyz");

      expect(results).toEqual([]);
    });

    it("respects limit parameter", () => {
      const results = repo.searchMessages("compiler", { limit: 1 });

      expect(results).toHaveLength(1);
    });

    it("is case-insensitive via LIKE", () => {
      const results = repo.searchMessages("COBOL");

      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("escapes percent wildcard in search query", () => {
      const results = repo.searchMessages("100%");

      expect(results).toHaveLength(1);
      expect(results[0]?.text).toBe(
        "We achieved 100% coverage on the test suite!",
      );
    });

    it("escapes underscore wildcard in search query", () => {
      const results = repo.searchMessages("field_name");

      expect(results).toHaveLength(1);
      expect(results[0]?.text).toBe(
        "The field_name parameter needs updating.",
      );
    });
  });

  describe("getMessageStats", () => {
    it("returns aggregate statistics", () => {
      const stats = repo.getMessageStats();

      expect(stats.totalMessages).toBe(8);
      expect(stats.totalChats).toBe(4);
      expect(stats.earliestMessage).toBe("2025-01-10T09:00:00.000Z");
      expect(stats.latestMessage).toBe("2025-01-14T09:30:00.000Z");
    });
  });
});
