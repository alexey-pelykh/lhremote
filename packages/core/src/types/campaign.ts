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

/**
 * Configuration for creating a new campaign.
 */
export interface CampaignConfig {
  /** Campaign name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** LinkedIn account ID (default: 1). */
  liAccountId?: number;
  /** Actions to include in the campaign. */
  actions: CampaignActionConfig[];
}

/**
 * Configuration for a single action within a campaign.
 */
export interface CampaignActionConfig {
  /** Display name for the action. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Action type identifier (e.g., 'VisitAndExtract', 'MessageToPerson'). */
  actionType: string;
  /** Milliseconds between action executions (default: 60000). */
  coolDown?: number;
  /** Maximum results per iteration (default: 10, -1 for unlimited). */
  maxActionResultsPerIteration?: number;
  /** Action-specific settings. */
  actionSettings?: ActionSettings;
}

/**
 * Runner state of the LinkedHelper main window.
 */
export type RunnerState = "idle" | "campaigns" | "stopping-campaigns";

/**
 * People counts for a campaign action by processing state.
 */
export interface ActionPeopleCounts {
  /** Action ID. */
  actionId: number;
  /** Number of people queued (state=1). */
  queued: number;
  /** Number of people processed (state=2). */
  processed: number;
  /** Number of successful executions (state=3). */
  successful: number;
  /** Number of failed executions (state=4). */
  failed: number;
}

/**
 * Real-time campaign execution status.
 */
export interface CampaignStatus {
  /** Campaign database record state. */
  campaignState: CampaignState;
  /** Whether the campaign is currently paused. */
  isPaused: boolean;
  /** Main window runner state. */
  runnerState: RunnerState;
  /** Per-action people counts. */
  actionCounts: ActionPeopleCounts[];
}

/**
 * Result of importing people into a campaign action from LinkedIn URLs.
 */
export interface ImportPeopleResult {
  /** Action ID the people were imported into. */
  actionId: number;
  /** Number of people successfully added. */
  successful: number;
  /** Number of people already in the target queue. */
  alreadyInQueue: number;
  /** Number of people already processed. */
  alreadyProcessed: number;
  /** Number of URLs that failed to import. */
  failed: number;
}

/**
 * Configuration for updating an existing campaign.
 *
 * At least one field must be provided.
 */
export interface CampaignUpdateConfig {
  /** New campaign name. */
  name?: string;
  /** New campaign description (null to clear). */
  description?: string | null;
}

/**
 * Aggregated results from a campaign run.
 */
export interface CampaignRunResult {
  /** Campaign ID. */
  campaignId: number;
  /** All action results from the database. */
  results: CampaignActionResult[];
  /** Per-action people counts (live from CDP). */
  actionCounts: ActionPeopleCounts[];
}

/**
 * An entry in an exclude list (campaign-level or action-level).
 */
export interface ExcludeListEntry {
  /** Internal person ID. */
  personId: number;
}
