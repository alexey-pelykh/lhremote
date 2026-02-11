import type {
  ActionConfig,
  ActionSettings,
  CampaignActionResult,
  Campaign,
  CampaignAction,
  CampaignState,
  CampaignSummary,
  CampaignUpdateConfig,
  GetResultsOptions,
  ListCampaignsOptions,
} from "../../types/index.js";
import type { DatabaseSync } from "node:sqlite";
import type { DatabaseClient } from "../client.js";
import { CampaignNotFoundError } from "../errors.js";

type PreparedStatement = ReturnType<DatabaseSync["prepare"]>;

interface CampaignRow {
  id: number;
  name: string;
  description: string | null;
  is_paused: number | null;
  is_archived: number | null;
  is_valid: number | null;
  li_account_id: number;
  created_at: string;
}

interface CampaignListRow extends CampaignRow {
  action_count: number;
}

interface CampaignActionRow {
  id: number;
  campaign_id: number;
  name: string;
  description: string | null;
  config_id: number;
  action_type: string;
  action_settings: string;
  cool_down: number;
  max_action_results_per_iteration: number;
  is_draft: number | null;
  version_id: number;
}

interface ActionResultRow {
  id: number;
  action_version_id: number;
  person_id: number;
  result: number;
  platform: string | null;
  created_at: string;
}

interface ActionVersionRow {
  id: number;
  action_id: number;
}

function deriveCampaignState(
  isPaused: number | null,
  isArchived: number | null,
  isValid: number | null,
): CampaignState {
  if (isArchived === 1) return "archived";
  if (isValid === 0) return "invalid";
  if (isPaused === 1) return "paused";
  return "active";
}

/**
 * Repository for campaign database operations.
 *
 * Provides read operations (list, get, getActions, getResults, getState)
 * and write operations (resetForRerun) for LinkedHelper campaigns.
 *
 * Write operations require the DatabaseClient to be opened with
 * `{ readOnly: false }`.
 */
export class CampaignRepository {
  private readonly stmtListCampaigns;
  private readonly stmtListAllCampaigns;
  private readonly stmtGetCampaign;
  private readonly stmtGetCampaignActions;
  private readonly stmtGetResults;
  private readonly stmtGetActionVersions;

  // Write statements (prepared lazily to avoid issues with read-only mode)
  private writeStatements: {
    fixIsValid: PreparedStatement;
    insertCollection: PreparedStatement;
    insertCollectionPeopleVersion: PreparedStatement;
    setActionVersionExcludeList: PreparedStatement;
    resetTargetPeople: PreparedStatement;
    resetHistory: PreparedStatement;
    deleteResultFlags: PreparedStatement;
    deleteResultMessages: PreparedStatement;
    deleteResults: PreparedStatement;
  } | null = null;

  constructor(private readonly client: DatabaseClient) {
    const { db } = client;

    this.stmtListCampaigns = db.prepare(
      `SELECT c.id, c.name, c.description, c.is_paused, c.is_archived,
              c.is_valid, c.li_account_id, c.created_at,
              (SELECT COUNT(*) FROM actions a WHERE a.campaign_id = c.id) AS action_count
       FROM campaigns c
       WHERE c.is_archived IS NULL OR c.is_archived = 0
       ORDER BY c.created_at DESC`,
    );

    this.stmtListAllCampaigns = db.prepare(
      `SELECT c.id, c.name, c.description, c.is_paused, c.is_archived,
              c.is_valid, c.li_account_id, c.created_at,
              (SELECT COUNT(*) FROM actions a WHERE a.campaign_id = c.id) AS action_count
       FROM campaigns c
       ORDER BY c.created_at DESC`,
    );

    this.stmtGetCampaign = db.prepare(
      `SELECT id, name, description, is_paused, is_archived, is_valid,
              li_account_id, created_at
       FROM campaigns WHERE id = ?`,
    );

    this.stmtGetCampaignActions = db.prepare(
      `SELECT a.id, a.campaign_id, a.name, a.description,
              ac.id AS config_id, ac.actionType AS action_type,
              ac.actionSettings AS action_settings, ac.coolDown AS cool_down,
              ac.maxActionResultsPerIteration AS max_action_results_per_iteration,
              ac.isDraft AS is_draft, av.id AS version_id
       FROM actions a
       JOIN action_versions av ON av.action_id = a.id
       JOIN action_configs ac ON av.config_id = ac.id
       WHERE a.campaign_id = ?
       ORDER BY a.id`,
    );

    this.stmtGetResults = db.prepare(
      `SELECT ar.id, ar.action_version_id, ar.person_id, ar.result,
              ar.platform, ar.created_at
       FROM action_results ar
       JOIN action_versions av ON ar.action_version_id = av.id
       JOIN actions a ON av.action_id = a.id
       WHERE a.campaign_id = ?
       ORDER BY ar.created_at DESC
       LIMIT ?`,
    );

    this.stmtGetActionVersions = db.prepare(
      `SELECT av.id, av.action_id
       FROM action_versions av
       JOIN actions a ON av.action_id = a.id
       WHERE a.campaign_id = ?`,
    );
  }

  /**
   * List campaigns, optionally including archived ones.
   */
  listCampaigns(options: ListCampaignsOptions = {}): CampaignSummary[] {
    const { includeArchived = false } = options;

    const stmt = includeArchived
      ? this.stmtListAllCampaigns
      : this.stmtListCampaigns;

    const rows = stmt.all() as unknown as CampaignListRow[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      state: deriveCampaignState(r.is_paused, r.is_archived, r.is_valid),
      liAccountId: r.li_account_id,
      actionCount: r.action_count,
      createdAt: r.created_at,
    }));
  }

  /**
   * Get a campaign by ID.
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   */
  getCampaign(campaignId: number): Campaign {
    const row = this.stmtGetCampaign.get(campaignId) as CampaignRow | undefined;
    if (!row) throw new CampaignNotFoundError(campaignId);

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      state: deriveCampaignState(row.is_paused, row.is_archived, row.is_valid),
      liAccountId: row.li_account_id,
      isPaused: row.is_paused === 1,
      isArchived: row.is_archived === 1,
      isValid: row.is_valid === null ? null : row.is_valid === 1,
      createdAt: row.created_at,
    };
  }

  /**
   * Get all actions for a campaign.
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   */
  getCampaignActions(campaignId: number): CampaignAction[] {
    // Verify campaign exists
    this.getCampaign(campaignId);

    const rows = this.stmtGetCampaignActions.all(
      campaignId,
    ) as unknown as CampaignActionRow[];

    return rows.map((r) => {
      let actionSettings: ActionSettings = {};
      try {
        actionSettings = JSON.parse(r.action_settings) as ActionSettings;
      } catch {
        // Keep empty object if parsing fails
      }

      const config: ActionConfig = {
        id: r.config_id,
        actionType: r.action_type,
        actionSettings,
        coolDown: r.cool_down,
        maxActionResultsPerIteration: r.max_action_results_per_iteration,
        isDraft: r.is_draft === 1,
      };

      return {
        id: r.id,
        campaignId: r.campaign_id,
        name: r.name,
        description: r.description,
        config,
        versionId: r.version_id,
      };
    });
  }

  /**
   * Get execution results for a campaign.
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   */
  getResults(
    campaignId: number,
    options: GetResultsOptions = {},
  ): CampaignActionResult[] {
    // Verify campaign exists
    this.getCampaign(campaignId);

    const { limit = 100 } = options;

    const rows = this.stmtGetResults.all(
      campaignId,
      limit,
    ) as unknown as ActionResultRow[];

    return rows.map((r) => ({
      id: r.id,
      actionVersionId: r.action_version_id,
      personId: r.person_id,
      result: r.result,
      platform: r.platform,
      createdAt: r.created_at,
    }));
  }

  /**
   * Get the current state of a campaign.
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   */
  getCampaignState(campaignId: number): CampaignState {
    const campaign = this.getCampaign(campaignId);
    return campaign.state;
  }

  /**
   * Update a campaign's name and/or description.
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   */
  updateCampaign(campaignId: number, updates: CampaignUpdateConfig): Campaign {
    // Verify campaign exists
    this.getCampaign(campaignId);

    const setClauses: string[] = [];
    const params: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      setClauses.push("name = ?");
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push("description = ?");
      params.push(updates.description);
    }

    if (setClauses.length > 0) {
      params.push(campaignId);
      const sql = `UPDATE campaigns SET ${setClauses.join(", ")} WHERE id = ?`;
      this.client.db.prepare(sql).run(...params);
    }

    return this.getCampaign(campaignId);
  }

  /**
   * Prepare write statements lazily (only when needed).
   * This avoids issues when the client is opened in read-only mode.
   */
  private getWriteStatements(): typeof this.writeStatements & object {
    if (this.writeStatements) return this.writeStatements;

    const { db } = this.client;

    this.writeStatements = {
      fixIsValid: db.prepare(
        `UPDATE campaigns SET is_valid = 1 WHERE id = ?`,
      ),
      insertCollection: db.prepare(
        `INSERT INTO collections (li_account_id, name, created_at, updated_at)
         VALUES (?, NULL, datetime('now'), datetime('now'))`,
      ),
      insertCollectionPeopleVersion: db.prepare(
        `INSERT INTO collection_people_versions
           (collection_id, version_operation_status, additional_data, created_at, updated_at)
         VALUES (?, 'addToTarget', NULL, datetime('now'), datetime('now'))`,
      ),
      setActionVersionExcludeList: db.prepare(
        `UPDATE action_versions SET exclude_list_id = ? WHERE action_id = ?`,
      ),
      resetTargetPeople: db.prepare(
        `UPDATE action_target_people SET state = 1
         WHERE action_id = ? AND person_id = ?`,
      ),
      resetHistory: db.prepare(
        `UPDATE person_in_campaigns_history
         SET result_status = -999,
             result_id = NULL,
             result_action_version_id = NULL,
             result_action_iteration_id = NULL,
             result_created_at = NULL,
             result_data = NULL,
             result_data_message = NULL,
             result_code = NULL,
             result_is_exception = NULL,
             result_who_to_blame = NULL,
             result_is_retryable = NULL,
             result_flag_recipient_replied = NULL,
             result_flag_sender_messaged = NULL,
             result_invited_platform = NULL,
             result_messaged_platform = NULL,
             add_to_target_or_result_saved_date = add_to_target_date
         WHERE campaign_id = ? AND person_id = ?`,
      ),
      deleteResultFlags: db.prepare(
        `DELETE FROM action_result_flags
         WHERE action_result_id IN (
           SELECT id FROM action_results
           WHERE action_version_id = ? AND person_id = ?
         )`,
      ),
      deleteResultMessages: db.prepare(
        `DELETE FROM action_result_messages
         WHERE action_result_id IN (
           SELECT id FROM action_results
           WHERE action_version_id = ? AND person_id = ?
         )`,
      ),
      deleteResults: db.prepare(
        `DELETE FROM action_results
         WHERE action_version_id = ? AND person_id = ?`,
      ),
    };

    return this.writeStatements;
  }

  /**
   * Fix the is_valid flag after programmatic campaign creation.
   *
   * Campaigns created via `createCampaign()` have `is_valid = NULL`,
   * making them invisible in the LinkedHelper UI. This sets
   * `is_valid = 1` to match the behavior of the UI campaign editor.
   */
  fixIsValid(campaignId: number): void {
    const stmts = this.getWriteStatements();
    stmts.fixIsValid.run(campaignId);
  }

  /**
   * Create action-level exclude lists after programmatic campaign creation.
   *
   * The `createCampaign()` API creates campaign-level exclude lists but
   * skips action-level ones due to a code path bug. The LH UI crashes
   * with "Expected excludeListId but got null" when opening campaigns
   * missing these. This creates the full exclude list chain for each
   * action: collection -> collection_people_versions -> action_versions.
   */
  createActionExcludeLists(campaignId: number, liAccountId: number): void {
    const actions = this.getCampaignActions(campaignId);
    if (actions.length === 0) return;

    const stmts = this.getWriteStatements();

    this.client.db.exec("BEGIN");
    try {
      for (const action of actions) {
        // 1. Create a collection for this action's exclude list
        stmts.insertCollection.run(liAccountId);
        const collectionId = (
          this.client.db
            .prepare("SELECT last_insert_rowid() AS id")
            .get() as { id: number }
        ).id;

        // 2. Create a collection_people_versions entry
        stmts.insertCollectionPeopleVersion.run(collectionId);
        const cpvId = (
          this.client.db
            .prepare("SELECT last_insert_rowid() AS id")
            .get() as { id: number }
        ).id;

        // 3. Set exclude_list_id on all action_versions for this action
        stmts.setActionVersionExcludeList.run(cpvId, action.id);
      }
      this.client.db.exec("COMMIT");
    } catch (e) {
      this.client.db.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Reset persons for re-run in a campaign.
   *
   * This performs the three-table reset pattern required by LinkedHelper:
   * 1. Requeue person in action_target_people (state = 1)
   * 2. Reset person_in_campaigns_history (result_status = -999)
   * 3. Delete old action_results (and FK children)
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   */
  resetForRerun(campaignId: number, personIds: number[]): void {
    if (personIds.length === 0) return;

    // Verify campaign exists and get actions
    const actions = this.getCampaignActions(campaignId);
    if (actions.length === 0) return;

    // Get all action versions for this campaign
    const actionVersionRows = this.stmtGetActionVersions.all(
      campaignId,
    ) as unknown as ActionVersionRow[];

    const stmts = this.getWriteStatements();

    this.client.db.exec("BEGIN");
    try {
      for (const personId of personIds) {
        // 1. Requeue person in action_target_people for each action
        for (const action of actions) {
          stmts.resetTargetPeople.run(action.id, personId);
        }

        // 2. Reset campaign history
        stmts.resetHistory.run(campaignId, personId);

        // 3. Delete old results for each action version
        for (const version of actionVersionRows) {
          stmts.deleteResultFlags.run(version.id, personId);
          stmts.deleteResultMessages.run(version.id, personId);
          stmts.deleteResults.run(version.id, personId);
        }
      }
      this.client.db.exec("COMMIT");
    } catch (e) {
      this.client.db.exec("ROLLBACK");
      throw e;
    }
  }
}
