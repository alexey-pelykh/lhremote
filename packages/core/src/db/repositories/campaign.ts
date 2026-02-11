import type {
  ActionConfig,
  ActionErrorSummary,
  ActionSettings,
  ActionStatistics,
  CampaignActionConfig,
  CampaignActionResult,
  Campaign,
  CampaignAction,
  CampaignState,
  CampaignStatistics,
  CampaignSummary,
  CampaignUpdateConfig,
  ExcludeListEntry,
  GetResultsOptions,
  GetStatisticsOptions,
  ListCampaignsOptions,
} from "../../types/index.js";
import type { DatabaseSync } from "node:sqlite";
import type { DatabaseClient } from "../client.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
  ExcludeListNotFoundError,
  NoNextActionError,
} from "../errors.js";

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
    insertActionConfig: PreparedStatement;
    insertAction: PreparedStatement;
    insertActionVersion: PreparedStatement;
    insertCollection: PreparedStatement;
    insertCollectionPeopleVersion: PreparedStatement;
    setActionVersionExcludeList: PreparedStatement;
    resetTargetPeople: PreparedStatement;
    resetHistory: PreparedStatement;
    deleteResultFlags: PreparedStatement;
    deleteResultMessages: PreparedStatement;
    deleteResults: PreparedStatement;
    markTargetSuccessful: PreparedStatement;
    queueTarget: PreparedStatement;
    insertTarget: PreparedStatement;
    countTarget: PreparedStatement;
    insertCollectionPerson: PreparedStatement;
    deleteCollectionPerson: PreparedStatement;
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
      insertActionConfig: db.prepare(
        `INSERT INTO action_configs (actionType, actionSettings, coolDown, maxActionResultsPerIteration, isDraft)
         VALUES (?, ?, ?, ?, 0)`,
      ),
      insertAction: db.prepare(
        `INSERT INTO actions (campaign_id, name, description, startAt)
         VALUES (?, ?, ?, datetime('now'))`,
      ),
      insertActionVersion: db.prepare(
        `INSERT INTO action_versions (action_id, config_id)
         VALUES (?, ?)`,
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
      markTargetSuccessful: db.prepare(
        `UPDATE action_target_people SET state = 3
         WHERE action_id = ? AND person_id = ?`,
      ),
      queueTarget: db.prepare(
        `UPDATE action_target_people SET state = 1
         WHERE action_id = ? AND person_id = ?`,
      ),
      insertTarget: db.prepare(
        `INSERT INTO action_target_people
           (action_id, action_version_id, person_id, state, li_account_id)
         VALUES (?, ?, ?, 1, ?)`,
      ),
      countTarget: db.prepare(
        `SELECT COUNT(*) AS cnt FROM action_target_people
         WHERE action_id = ? AND person_id = ?`,
      ),
      insertCollectionPerson: db.prepare(
        `INSERT OR IGNORE INTO collection_people (collection_id, person_id)
         VALUES (?, ?)`,
      ),
      deleteCollectionPerson: db.prepare(
        `DELETE FROM collection_people
         WHERE collection_id = ? AND person_id = ?`,
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
   * Add a new action to an existing campaign's action chain.
   *
   * Creates the full action record set via direct DB operations:
   * action_configs -> actions -> action_versions (x2) -> exclude list chain.
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   */
  addAction(
    campaignId: number,
    actionConfig: CampaignActionConfig,
    liAccountId: number,
  ): CampaignAction {
    // Verify campaign exists
    this.getCampaign(campaignId);

    const stmts = this.getWriteStatements();
    const { db } = this.client;

    const getLastId = db.prepare(
      "SELECT last_insert_rowid() AS id",
    );

    db.exec("BEGIN");
    try {
      // 1. Insert action_configs
      const actionSettings = JSON.stringify(actionConfig.actionSettings ?? {});
      const coolDown = actionConfig.coolDown ?? 60_000;
      const maxResults = actionConfig.maxActionResultsPerIteration ?? 10;

      stmts.insertActionConfig.run(
        actionConfig.actionType,
        actionSettings,
        coolDown,
        maxResults,
      );
      const configId = (getLastId.get() as { id: number }).id;

      // 2. Insert actions
      stmts.insertAction.run(
        campaignId,
        actionConfig.name,
        actionConfig.description ?? "",
      );
      const actionId = (getLastId.get() as { id: number }).id;

      // 3. Insert two action_versions (matching createCampaign pattern)
      stmts.insertActionVersion.run(actionId, configId);
      const versionId1 = (getLastId.get() as { id: number }).id;
      stmts.insertActionVersion.run(actionId, configId);

      // 4. Create exclude list chain for the new action
      stmts.insertCollection.run(liAccountId);
      const collectionId = (getLastId.get() as { id: number }).id;

      stmts.insertCollectionPeopleVersion.run(collectionId);
      const cpvId = (getLastId.get() as { id: number }).id;

      stmts.setActionVersionExcludeList.run(cpvId, actionId);

      db.exec("COMMIT");

      // Build and return the CampaignAction
      const config: ActionConfig = {
        id: configId,
        actionType: actionConfig.actionType,
        actionSettings: actionConfig.actionSettings ?? {},
        coolDown,
        maxActionResultsPerIteration: maxResults,
        isDraft: false,
      };

      return {
        id: actionId,
        campaignId,
        name: actionConfig.name,
        description: actionConfig.description ?? null,
        config,
        versionId: versionId1,
      };
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Move people from the current action to the next action in the chain.
   *
   * For each person:
   * 1. Mark the person as successful (state=3) in the current action
   * 2. Queue the person (state=1) in the next action's target list
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   * @throws {ActionNotFoundError} if the action does not belong to the campaign.
   * @throws {NoNextActionError} if the action is the last in the chain.
   */
  moveToNextAction(
    campaignId: number,
    actionId: number,
    personIds: number[],
  ): { nextActionId: number } {
    if (personIds.length === 0) return { nextActionId: 0 };

    // Get all actions ordered by id
    const actions = this.getCampaignActions(campaignId);

    // Find the current action index
    const currentIndex = actions.findIndex((a) => a.id === actionId);
    if (currentIndex === -1) {
      throw new ActionNotFoundError(actionId, campaignId);
    }

    // Find the next action
    if (currentIndex >= actions.length - 1) {
      throw new NoNextActionError(actionId, campaignId);
    }

    const nextAction = actions[currentIndex + 1] as (typeof actions)[0];
    const campaign = this.getCampaign(campaignId);
    const stmts = this.getWriteStatements();

    this.client.db.exec("BEGIN");
    try {
      for (const personId of personIds) {
        // 1. Mark person as successful in the current action
        stmts.markTargetSuccessful.run(actionId, personId);

        // 2. Queue person in the next action's target list
        const { cnt } = stmts.countTarget.get(
          nextAction.id,
          personId,
        ) as { cnt: number };

        if (cnt > 0) {
          stmts.queueTarget.run(nextAction.id, personId);
        } else {
          stmts.insertTarget.run(
            nextAction.id,
            nextAction.versionId,
            personId,
            campaign.liAccountId,
          );
        }
      }
      this.client.db.exec("COMMIT");
    } catch (e) {
      this.client.db.exec("ROLLBACK");
      throw e;
    }

    return { nextActionId: nextAction.id };
  }

  /**
   * Resolve the collection_id for an exclude list.
   *
   * Follows the chain: exclude_list_id → collection_people_versions → collection_id.
   *
   * @param level - "campaign" or "action"
   * @param id - Campaign ID (if level is "campaign") or action ID (if level is "action")
   * @throws {CampaignNotFoundError} if level is "campaign" and campaign does not exist.
   * @throws {ExcludeListNotFoundError} if the exclude list chain is not found.
   */
  private resolveExcludeListCollectionId(
    level: "campaign" | "action",
    id: number,
  ): number {
    const { db } = this.client;

    let excludeListId: number | null = null;

    if (level === "campaign") {
      const row = db
        .prepare(
          `SELECT exclude_list_id FROM campaign_versions
           WHERE campaign_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(id) as { exclude_list_id: number | null } | undefined;
      excludeListId = row?.exclude_list_id ?? null;
    } else {
      const row = db
        .prepare(
          `SELECT exclude_list_id FROM action_versions
           WHERE action_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(id) as { exclude_list_id: number | null } | undefined;
      excludeListId = row?.exclude_list_id ?? null;
    }

    if (excludeListId === null) {
      throw new ExcludeListNotFoundError(level, id);
    }

    // Resolve CPV → collection_id
    const cpv = db
      .prepare(
        `SELECT collection_id FROM collection_people_versions WHERE id = ?`,
      )
      .get(excludeListId) as { collection_id: number } | undefined;

    if (!cpv) {
      throw new ExcludeListNotFoundError(level, id);
    }

    return cpv.collection_id;
  }

  /**
   * Get the exclude list for a campaign or action.
   *
   * @param campaignId - Campaign ID (verified to exist).
   * @param actionId - If provided, get the action-level exclude list.
   *   Otherwise, get the campaign-level exclude list.
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   * @throws {ActionNotFoundError} if actionId is provided and not in the campaign.
   * @throws {ExcludeListNotFoundError} if the exclude list chain is not found.
   */
  getExcludeList(
    campaignId: number,
    actionId?: number,
  ): ExcludeListEntry[] {
    // Verify campaign exists
    this.getCampaign(campaignId);

    if (actionId !== undefined) {
      // Verify action belongs to campaign
      const actions = this.getCampaignActions(campaignId);
      if (!actions.some((a) => a.id === actionId)) {
        throw new ActionNotFoundError(actionId, campaignId);
      }
    }

    const level = actionId !== undefined ? "action" : "campaign";
    const targetId = actionId ?? campaignId;
    const collectionId = this.resolveExcludeListCollectionId(level, targetId);

    const rows = this.client.db
      .prepare(
        `SELECT person_id FROM collection_people
         WHERE collection_id = ?
         ORDER BY person_id`,
      )
      .all(collectionId) as unknown as { person_id: number }[];

    return rows.map((r) => ({ personId: r.person_id }));
  }

  /**
   * Add people to a campaign or action exclude list.
   *
   * @param campaignId - Campaign ID (verified to exist).
   * @param personIds - Person IDs to add.
   * @param actionId - If provided, add to the action-level exclude list.
   * @returns Number of people actually added (excludes already-present).
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   * @throws {ActionNotFoundError} if actionId is provided and not in the campaign.
   * @throws {ExcludeListNotFoundError} if the exclude list chain is not found.
   */
  addToExcludeList(
    campaignId: number,
    personIds: number[],
    actionId?: number,
  ): number {
    if (personIds.length === 0) return 0;

    // Verify campaign exists
    this.getCampaign(campaignId);

    if (actionId !== undefined) {
      const actions = this.getCampaignActions(campaignId);
      if (!actions.some((a) => a.id === actionId)) {
        throw new ActionNotFoundError(actionId, campaignId);
      }
    }

    const level = actionId !== undefined ? "action" : "campaign";
    const targetId = actionId ?? campaignId;
    const collectionId = this.resolveExcludeListCollectionId(level, targetId);

    const stmts = this.getWriteStatements();
    let added = 0;

    this.client.db.exec("BEGIN");
    try {
      for (const personId of personIds) {
        const result = stmts.insertCollectionPerson.run(
          collectionId,
          personId,
        );
        if (result.changes > 0) added++;
      }
      this.client.db.exec("COMMIT");
    } catch (e) {
      this.client.db.exec("ROLLBACK");
      throw e;
    }

    return added;
  }

  /**
   * Remove people from a campaign or action exclude list.
   *
   * @param campaignId - Campaign ID (verified to exist).
   * @param personIds - Person IDs to remove.
   * @param actionId - If provided, remove from the action-level exclude list.
   * @returns Number of people actually removed.
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   * @throws {ActionNotFoundError} if actionId is provided and not in the campaign.
   * @throws {ExcludeListNotFoundError} if the exclude list chain is not found.
   */
  removeFromExcludeList(
    campaignId: number,
    personIds: number[],
    actionId?: number,
  ): number {
    if (personIds.length === 0) return 0;

    // Verify campaign exists
    this.getCampaign(campaignId);

    if (actionId !== undefined) {
      const actions = this.getCampaignActions(campaignId);
      if (!actions.some((a) => a.id === actionId)) {
        throw new ActionNotFoundError(actionId, campaignId);
      }
    }

    const level = actionId !== undefined ? "action" : "campaign";
    const targetId = actionId ?? campaignId;
    const collectionId = this.resolveExcludeListCollectionId(level, targetId);

    const stmts = this.getWriteStatements();
    let removed = 0;

    this.client.db.exec("BEGIN");
    try {
      for (const personId of personIds) {
        const result = stmts.deleteCollectionPerson.run(
          collectionId,
          personId,
        );
        if (result.changes > 0) removed++;
      }
      this.client.db.exec("COMMIT");
    } catch (e) {
      this.client.db.exec("ROLLBACK");
      throw e;
    }

    return removed;
  }

  /**
   * Get aggregated statistics for a campaign.
   *
   * Returns per-action result breakdowns (success/failure/skip/reply rates),
   * top error codes with blame attribution, and processing timeline.
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   * @throws {ActionNotFoundError} if actionId is provided and not in the campaign.
   */
  getStatistics(
    campaignId: number,
    options: GetStatisticsOptions = {},
  ): CampaignStatistics {
    const { actionId, maxErrors = 5 } = options;

    // Get actions (also validates campaign exists)
    const actions = this.getCampaignActions(campaignId);

    if (actionId !== undefined) {
      if (!actions.some((a) => a.id === actionId)) {
        throw new ActionNotFoundError(actionId, campaignId);
      }
    }

    const filteredActions = actionId !== undefined
      ? actions.filter((a) => a.id === actionId)
      : actions;

    const { db } = this.client;

    const stmtActionStats = db.prepare(
      `SELECT
         SUM(CASE WHEN ar.result = 1 THEN 1 ELSE 0 END) AS successful,
         SUM(CASE WHEN ar.result = 2 THEN 1 ELSE 0 END) AS replied,
         SUM(CASE WHEN ar.result = -1 THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN ar.result = -2 THEN 1 ELSE 0 END) AS skipped,
         COUNT(*) AS total,
         MIN(ar.created_at) AS first_result_at,
         MAX(ar.created_at) AS last_result_at
       FROM action_results ar
       JOIN action_versions av ON ar.action_version_id = av.id
       WHERE av.action_id = ?`,
    );

    const stmtTopErrors = db.prepare(
      `SELECT
         arf.code,
         COUNT(*) AS cnt,
         arf.is_exception,
         arf.who_to_blame
       FROM action_result_flags arf
       JOIN action_results ar ON arf.action_result_id = ar.id
       JOIN action_versions av ON ar.action_version_id = av.id
       WHERE av.action_id = ? AND arf.code IS NOT NULL
       GROUP BY arf.code, arf.is_exception, arf.who_to_blame
       ORDER BY cnt DESC
       LIMIT ?`,
    );

    interface ActionStatsRow {
      successful: number;
      replied: number;
      failed: number;
      skipped: number;
      total: number;
      first_result_at: string | null;
      last_result_at: string | null;
    }

    interface ErrorRow {
      code: number;
      cnt: number;
      is_exception: number;
      who_to_blame: string;
    }

    const actionStats: ActionStatistics[] = [];
    let totalSuccessful = 0;
    let totalReplied = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let grandTotal = 0;

    for (const action of filteredActions) {
      const stats = stmtActionStats.get(
        action.id,
      ) as unknown as ActionStatsRow;

      const successful = stats.successful ?? 0;
      const replied = stats.replied ?? 0;
      const failed = stats.failed ?? 0;
      const skipped = stats.skipped ?? 0;
      const total = stats.total ?? 0;
      const successRate = total > 0
        ? Math.round(((successful + replied) / total) * 1000) / 10
        : 0;

      const errorRows = stmtTopErrors.all(
        action.id,
        maxErrors,
      ) as unknown as ErrorRow[];

      const topErrors: ActionErrorSummary[] = errorRows.map((e) => ({
        code: e.code,
        count: e.cnt,
        isException: e.is_exception === 1,
        whoToBlame: e.who_to_blame,
      }));

      actionStats.push({
        actionId: action.id,
        actionName: action.name,
        actionType: action.config.actionType,
        successful,
        replied,
        failed,
        skipped,
        total,
        successRate,
        firstResultAt: stats.first_result_at,
        lastResultAt: stats.last_result_at,
        topErrors,
      });

      totalSuccessful += successful;
      totalReplied += replied;
      totalFailed += failed;
      totalSkipped += skipped;
      grandTotal += total;
    }

    const totalSuccessRate = grandTotal > 0
      ? Math.round(((totalSuccessful + totalReplied) / grandTotal) * 1000) / 10
      : 0;

    return {
      campaignId,
      actions: actionStats,
      totals: {
        successful: totalSuccessful,
        replied: totalReplied,
        failed: totalFailed,
        skipped: totalSkipped,
        total: grandTotal,
        successRate: totalSuccessRate,
      },
    };
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
