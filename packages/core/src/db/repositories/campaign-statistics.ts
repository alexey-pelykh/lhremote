// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type {
  ActionConfig,
  ActionErrorSummary,
  ActionSettings,
  ActionStatistics,
  CampaignAction,
  CampaignStatistics,
  GetStatisticsOptions,
} from "../../types/index.js";
import type { DatabaseClient } from "../client.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
} from "../errors.js";

type PreparedStatement = ReturnType<
  import("node:sqlite").DatabaseSync["prepare"]
>;

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

interface ActionVersionRow {
  id: number;
  action_id: number;
}

/**
 * Repository for campaign statistics and reset operations.
 *
 * Provides read operations (getStatistics) and write operations
 * (resetForRerun) for campaign execution data.
 *
 * Write operations require the DatabaseClient to be opened with
 * `{ readOnly: false }`.
 */
export class CampaignStatisticsRepository {
  private readonly stmtGetCampaign;
  private readonly stmtGetCampaignActions;
  private readonly stmtGetActionVersions;

  // Write statements (prepared lazily to avoid issues with read-only mode)
  private writeStatements: {
    resetTargetPeople: PreparedStatement;
    resetHistory: PreparedStatement;
    deleteResultFlags: PreparedStatement;
    deleteResultMessages: PreparedStatement;
    deleteResults: PreparedStatement;
  } | null = null;

  constructor(private readonly client: DatabaseClient) {
    const { db } = client;

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

    this.stmtGetActionVersions = db.prepare(
      `SELECT av.id, av.action_id
       FROM action_versions av
       JOIN actions a ON av.action_id = a.id
       WHERE a.campaign_id = ?`,
    );
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

  /**
   * Get all actions for a campaign.
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   */
  private getCampaignActions(campaignId: number): CampaignAction[] {
    // Verify campaign exists
    this.verifyCampaignExists(campaignId);

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
   * Prepare write statements lazily (only when needed).
   * This avoids issues when the client is opened in read-only mode.
   */
  private getWriteStatements(): typeof this.writeStatements & object {
    if (this.writeStatements) return this.writeStatements;

    const { db } = this.client;

    this.writeStatements = {
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
   * Verify that a campaign exists.
   *
   * @throws {CampaignNotFoundError} if no campaign exists with the given ID.
   */
  private verifyCampaignExists(campaignId: number): void {
    const row = this.stmtGetCampaign.get(campaignId);
    if (!row) throw new CampaignNotFoundError(campaignId);
  }
}
