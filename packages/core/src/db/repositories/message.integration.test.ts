// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseClient } from "../client.js";
import { ChatNotFoundError } from "../errors.js";
import { FIXTURE_PATH } from "../testing/open-fixture.js";
import { MessageRepository } from "./message.js";

describe("MessageRepository (integration)", () => {
  let client: DatabaseClient;
  let repo: MessageRepository;

  beforeAll(() => {
    client = new DatabaseClient(FIXTURE_PATH);
    repo = new MessageRepository(client);
  });

  afterAll(() => {
    client.close();
  });

  describe("listChats", () => {
    it("lists all chats with participants and last message", () => {
      const chats = repo.listChats();

      expect(chats.length).toBeGreaterThanOrEqual(3);

      const chat1 = chats.find((c) => c.id === 1);
      expect(chat1).toBeDefined();
      expect(chat1?.type).toBe("MEMBER_TO_MEMBER");
      expect(chat1?.platform).toBe("LINKEDIN");
      expect(chat1?.participants.length).toBeGreaterThanOrEqual(2);
      expect(chat1?.messageCount).toBe(3);
      expect(chat1?.lastMessage).not.toBeNull();
    });

    it("filters chats by person", () => {
      // Person 1 (Ada) participates in chat 1, chat 2, and chat 4
      const chats = repo.listChats({ personId: 1 });

      expect(chats).toHaveLength(3);
      const chatIds = chats.map((c) => c.id);
      expect(chatIds).toContain(1);
      expect(chatIds).toContain(2);
      expect(chatIds).toContain(4);
    });
  });

  describe("getThread", () => {
    it("retrieves a full conversation thread from the real schema", () => {
      const thread = repo.getThread(1);

      expect(thread.chat.id).toBe(1);
      expect(thread.chat.participants.length).toBeGreaterThanOrEqual(2);
      expect(thread.messages.length).toBeGreaterThanOrEqual(3);

      // Messages should be in chronological order
      const sendTimes = thread.messages.map((m) => m.sendAt);
      const sorted = [...sendTimes].sort();
      expect(sendTimes).toEqual(sorted);
    });

    it("includes sender information from person_mini_profile", () => {
      const thread = repo.getThread(1);
      const adaMessage = thread.messages.find((m) => m.senderPersonId === 1);

      expect(adaMessage).toBeDefined();
      expect(adaMessage?.senderFirstName).toBe("Ada");
      expect(adaMessage?.senderLastName).toBe("Lovelace");
    });

    it("throws ChatNotFoundError for a nonexistent chat", () => {
      expect(() => repo.getThread(999)).toThrow(ChatNotFoundError);
    });
  });

  describe("searchMessages", () => {
    it("searches across all chats", () => {
      const results = repo.searchMessages("compiler");

      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const msg of results) {
        expect(msg.text.toLowerCase()).toContain("compiler");
      }
    });

    it("returns empty for no matches", () => {
      const results = repo.searchMessages("zzz-no-match-zzz");
      expect(results).toEqual([]);
    });
  });

  describe("getMessageStats", () => {
    it("returns stats across all messaging data", () => {
      const stats = repo.getMessageStats();

      expect(stats.totalMessages).toBeGreaterThanOrEqual(6);
      expect(stats.totalChats).toBeGreaterThanOrEqual(3);
      expect(stats.earliestMessage).toBeTruthy();
      expect(stats.latestMessage).toBeTruthy();
    });
  });

  describe("getMessagesSince", () => {
    it("returns messages after a given timestamp grouped by conversation", () => {
      // Fixture has messages at 2025-01-10, 2025-01-11, 2025-01-12, 2025-01-13, 2025-01-14
      const conversations = repo.getMessagesSince("2025-01-12T00:00:00.000Z");

      // Should include: msg 4 (2025-01-12), msg 5 (2025-01-13), msg 6 (2025-01-13),
      //                 msg 7 (2025-01-14), msg 8 (2025-01-14)
      const totalMessages = conversations.reduce(
        (sum, c) => sum + c.messages.length,
        0,
      );
      expect(totalMessages).toBe(5);

      // Each conversation should have chatId, personId, personName
      for (const conv of conversations) {
        expect(conv.chatId).toBeGreaterThan(0);
        expect(conv.personId).toBeGreaterThan(0);
        expect(conv.personName).toBeTruthy();
        expect(conv.messages.length).toBeGreaterThan(0);
      }
    });

    it("returns empty array when no messages after the cutoff", () => {
      const conversations = repo.getMessagesSince("2099-01-01T00:00:00.000Z");
      expect(conversations).toEqual([]);
    });

    it("returns all messages when cutoff is before earliest message", () => {
      const conversations = repo.getMessagesSince("2000-01-01T00:00:00.000Z");

      const totalMessages = conversations.reduce(
        (sum, c) => sum + c.messages.length,
        0,
      );
      // Fixture has 8 messages total
      expect(totalMessages).toBe(8);
    });

    it("groups messages by chat and sender", () => {
      // Get messages including chat 1 (Ada ↔ Grace, 3 messages from 2 senders)
      const conversations = repo.getMessagesSince("2025-01-09T00:00:00.000Z");

      // Chat 1 should have 2 groups (Ada sent 2, Grace sent 1)
      const chat1Groups = conversations.filter((c) => c.chatId === 1);
      expect(chat1Groups).toHaveLength(2);
    });
  });

  describe("cross-table consistency", () => {
    it("chat participants reference valid people with mini profiles", () => {
      const chats = repo.listChats();

      for (const chat of chats) {
        for (const participant of chat.participants) {
          expect(participant.personId).toBeGreaterThan(0);
          expect(participant.firstName).toBeTruthy();
        }
      }
    });

    it("thread messages reference valid senders from chat participants", () => {
      const thread = repo.getThread(1);
      const participantIds = thread.chat.participants.map((p) => p.personId);

      for (const msg of thread.messages) {
        expect(participantIds).toContain(msg.senderPersonId);
      }
    });
  });
});
