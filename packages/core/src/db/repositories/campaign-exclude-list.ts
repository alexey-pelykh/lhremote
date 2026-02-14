// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { ExcludeListEntry } from "../../types/index.js";
import type { DatabaseClient } from "../client.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
  ExcludeListNotFoundError,
} from "../errors.js";

type PreparedStatement = ReturnType<
  import("node:sqlite").DatabaseSync["prepare"]
>;

/**
 * Repository for campaign exclude-list operations.
 *
 * Provides read operations (getExcludeList) and write operations
 * (addToExcludeList, removeFromExcludeList) for campaign and
 * action-level exclude lists.
 *
 * Write operations require the DatabaseClient to be opened with
 * `{ readOnly: false }`.
 */
export class CampaignExcludeListRepository {
  private readonly stmtGetCampaign;
  private readonly stmtGetCampaignActions;

  // Write statements (prepared lazily to avoid issues with read-only mode)
  private writeStatements: {
    insertCollectionPerson: PreparedStatement;
    deleteCollectionPerson: PreparedStatement;
  } | null = null;

  constructor(private readonly client: DatabaseClient) {
    const { db } = client;

    this.stmtGetCampaign = db.prepare(
      `SELECT id, name, description, is_paused, is_archived, is_valid,
              li_account_id, created_at
       FROM campaigns WHERE id = ?`,
    );

    this.stmtGetCampaignActions = db.prepare(
      `SELECT a.id, a.campaign_id
       FROM actions a
       WHERE a.campaign_id = ?
       ORDER BY a.id`,
    );
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
    const { collectionId } = this.resolveExcludeListContext(
      campaignId,
      actionId,
    );

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

    const { collectionId } = this.resolveExcludeListContext(
      campaignId,
      actionId,
    );

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

    const { collectionId } = this.resolveExcludeListContext(
      campaignId,
      actionId,
    );

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
   * Prepare write statements lazily (only when needed).
   * This avoids issues when the client is opened in read-only mode.
   */
  private getWriteStatements(): typeof this.writeStatements & object {
    if (this.writeStatements) return this.writeStatements;

    const { db } = this.client;

    this.writeStatements = {
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
   * Resolve the collection_id for an exclude list.
   *
   * Follows the chain: exclude_list_id -> collection_people_versions -> collection_id.
   *
   * @param level - "campaign" or "action"
   * @param id - Campaign ID (if level is "campaign") or action ID (if level is "action")
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

    // Resolve CPV -> collection_id
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
   * Validate campaign/action and resolve the exclude-list collection ID.
   *
   * Shared preamble for {@link getExcludeList}, {@link addToExcludeList},
   * and {@link removeFromExcludeList}.
   *
   * @param campaignId - Campaign ID (verified to exist).
   * @param actionId - If provided, scope to the action-level exclude list.
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   * @throws {ActionNotFoundError} if actionId is provided and not in the campaign.
   * @throws {ExcludeListNotFoundError} if the exclude list chain is not found.
   */
  private resolveExcludeListContext(
    campaignId: number,
    actionId?: number,
  ): { collectionId: number; level: "campaign" | "action"; targetId: number } {
    this.verifyCampaignExists(campaignId);

    if (actionId !== undefined) {
      const rows = this.stmtGetCampaignActions.all(
        campaignId,
      ) as unknown as { id: number; campaign_id: number }[];
      if (!rows.some((a) => a.id === actionId)) {
        throw new ActionNotFoundError(actionId, campaignId);
      }
    }

    const level = actionId !== undefined ? "action" : "campaign";
    const targetId = actionId ?? campaignId;
    const collectionId = this.resolveExcludeListCollectionId(level, targetId);

    return { collectionId, level, targetId };
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
