// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

export { DatabaseClient, type DatabaseClientOptions } from "./client.js";
export { discoverAllDatabases, discoverDatabase } from "./discovery.js";
export {
  ActionNotFoundError,
  CampaignNotFoundError,
  ChatNotFoundError,
  DatabaseError,
  DatabaseNotFoundError,
  ExcludeListNotFoundError,
  NoNextActionError,
  ProfileNotFoundError,
} from "./errors.js";
export {
  CampaignRepository,
  MessageRepository,
  ProfileRepository,
} from "./repositories/index.js";
