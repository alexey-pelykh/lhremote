/**
 * Messaging types derived from LinkedHelper's SQLite schema.
 *
 * Root entity: `chats` table (M:N with people via `chat_participants`,
 * M:N with messages via `participant_messages`).
 */

export interface ChatParticipant {
  personId: number;
  firstName: string;
  lastName: string | null;
}

export interface MessageSummary {
  text: string;
  sendAt: string;
}

export interface Chat {
  id: number;
  type: string;
  platform: string;
  participants: ChatParticipant[];
  messageCount: number;
  lastMessage: MessageSummary | null;
}

export interface Message {
  id: number;
  type: string;
  text: string;
  subject: string | null;
  sendAt: string;
  attachmentsCount: number;
  senderPersonId: number;
  senderFirstName: string;
  senderLastName: string | null;
}

export interface ConversationThread {
  chat: Chat;
  messages: Message[];
}

export interface MessageStats {
  totalMessages: number;
  totalChats: number;
  earliestMessage: string | null;
  latestMessage: string | null;
}
