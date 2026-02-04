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
      // Person 1 (Ada) participates in chat 1 and chat 2
      const chats = repo.listChats({ personId: 1 });

      expect(chats).toHaveLength(2);
      const chatIds = chats.map((c) => c.id);
      expect(chatIds).toContain(1);
      expect(chatIds).toContain(2);
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
