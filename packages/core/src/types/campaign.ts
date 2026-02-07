/**
 * Campaign state enumeration.
 */
export type CampaignState =
  | "active"
  | "paused"
  | "archived"
  | "invalid";

/**
 * Summary view of a campaign for list operations.
 */
export interface CampaignSummary {
  id: number;
  name: string;
  description: string | null;
  state: CampaignState;
  liAccountId: number;
  actionCount: number;
  createdAt: string;
}

/**
 * Full campaign with metadata.
 */
export interface Campaign {
  id: number;
  name: string;
  description: string | null;
  state: CampaignState;
  liAccountId: number;
  isPaused: boolean;
  isArchived: boolean;
  isValid: boolean | null;
  createdAt: string;
}

/**
 * Action configuration settings (stored as JSON in database).
 */
export interface ActionSettings {
  [key: string]: unknown;
}

/**
 * Action configuration.
 */
export interface ActionConfig {
  id: number;
  actionType: string;
  actionSettings: ActionSettings;
  coolDown: number;
  maxActionResultsPerIteration: number;
  isDraft: boolean;
}

/**
 * Campaign action definition.
 */
export interface CampaignAction {
  id: number;
  campaignId: number;
  name: string;
  description: string | null;
  config: ActionConfig;
  versionId: number;
}

/**
 * Result of a campaign action execution.
 */
export interface CampaignActionResult {
  id: number;
  actionVersionId: number;
  personId: number;
  result: number;
  platform: string | null;
  createdAt: string;
}

/**
 * Person target state in a campaign action.
 */
export interface ActionTargetPerson {
  actionId: number;
  actionVersionId: number;
  personId: number;
  state: number;
  liAccountId: number;
}

/**
 * Options for listing campaigns.
 */
export interface ListCampaignsOptions {
  includeArchived?: boolean;
}

/**
 * Options for getting action results.
 */
export interface GetResultsOptions {
  limit?: number;
}
