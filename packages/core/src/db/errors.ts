/**
 * Base class for all database-related errors.
 */
export class DatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseError";
  }
}

/**
 * Thrown when a LinkedHelper database file cannot be found at the
 * expected location for a given account.
 */
export class DatabaseNotFoundError extends DatabaseError {
  constructor(accountId: number) {
    super(`No database found for account ${String(accountId)}`);
    this.name = "DatabaseNotFoundError";
  }
}

/**
 * Thrown when a chat lookup yields no results.
 */
export class ChatNotFoundError extends DatabaseError {
  constructor(chatId: number) {
    super(`Chat not found for id ${String(chatId)}`);
    this.name = "ChatNotFoundError";
  }
}

/**
 * Thrown when a profile lookup yields no results. The person may not
 * have been extracted by LinkedHelper yet.
 */
export class ProfileNotFoundError extends DatabaseError {
  constructor(identifier: number | string) {
    const detail =
      typeof identifier === "number"
        ? `id ${String(identifier)}`
        : `public ID "${identifier}"`;
    super(
      `Profile not found for ${detail}. It may not have been extracted yet.`,
    );
    this.name = "ProfileNotFoundError";
  }
}

/**
 * Thrown when a campaign lookup yields no results.
 */
export class CampaignNotFoundError extends DatabaseError {
  constructor(campaignId: number) {
    super(`Campaign not found for id ${String(campaignId)}`);
    this.name = "CampaignNotFoundError";
  }
}
