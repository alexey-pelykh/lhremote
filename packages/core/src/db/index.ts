// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

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
  CampaignExcludeListRepository,
  CampaignRepository,
  CampaignStatisticsRepository,
  MessageRepository,
  ProfileRepository,
} from "./repositories/index.js";
