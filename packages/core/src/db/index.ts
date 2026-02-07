export { DatabaseClient, type DatabaseClientOptions } from "./client.js";
export { discoverAllDatabases, discoverDatabase } from "./discovery.js";
export {
  CampaignNotFoundError,
  ChatNotFoundError,
  DatabaseError,
  DatabaseNotFoundError,
  ProfileNotFoundError,
} from "./errors.js";
export {
  CampaignRepository,
  MessageRepository,
  ProfileRepository,
} from "./repositories/index.js";
