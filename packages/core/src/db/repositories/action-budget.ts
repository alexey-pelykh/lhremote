// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionBudgetEntry, LimitType } from "../../types/index.js";
import type { DatabaseClient } from "../client.js";

/**
 * Maps LinkedHelper action config types to their corresponding limit type IDs.
 *
 * These IDs match the `limit_types` table in the LH database.
 * Action types that do not consume daily limits (e.g. Waiter,
 * FilterContactsOutOfMyNetwork) are intentionally omitted.
 */
const ACTION_TYPE_TO_LIMIT_TYPE: ReadonlyMap<string, number> = new Map([
  ["SaveCurrentProfile", 1],
  ["InvitePerson", 8],
  ["SendMessage", 9],
  ["MessageToEventAttendees", 10],
  ["SendInMail", 11],
  ["EndorseSkills", 12],
  ["InviteToGroup", 13],
  ["Follow", 16],
  ["Unfollow", 17],
  ["LikePost", 18],
  ["SendPersonToWebhook", 23],
  ["GetEmailFromPAS", 24],
  ["SendPersonToExternalCRM", 31],
]);

interface LimitTypeRow {
  id: number;
  type: string;
}

interface DailyLimitRow {
  id: number;
  max_limit: number;
}

interface ActionCountRow {
  action_type: string;
  count_today: number;
}

/**
 * Repository for reading LinkedHelper rate limit data.
 *
 * Reads from LH's `limit_types`, `daily_limits`, and `action_results`
 * tables to compute the current action budget.
 */
export class ActionBudgetRepository {
  private readonly stmtLimitTypes;
  private readonly stmtDailyLimits;
  private readonly stmtTodayCountsByType;

  constructor(client: DatabaseClient) {
    const { db } = client;

    this.stmtLimitTypes = db.prepare(
      `SELECT id, type FROM limit_types ORDER BY id`,
    );

    this.stmtDailyLimits = db.prepare(
      `SELECT id, max_limit FROM daily_limits`,
    );

    this.stmtTodayCountsByType = db.prepare(
      `SELECT ac.actionType AS action_type, COUNT(*) AS count_today
       FROM action_results ar
       JOIN action_versions av ON ar.action_version_id = av.id
       JOIN action_configs ac ON av.config_id = ac.id
       WHERE date(ar.created_at) = date('now', 'localtime')
       GROUP BY ac.actionType`,
    );
  }

  /**
   * Get all limit types defined by LinkedHelper.
   */
  getLimitTypes(): LimitType[] {
    const rows = this.stmtLimitTypes.all() as unknown as LimitTypeRow[];
    return rows.map((r) => ({ id: r.id, type: r.type }));
  }

  /**
   * Get the full action budget: limit types, daily limits, and today's usage.
   *
   * Campaign usage comes from LH's `action_results` table.
   * Direct usage (CDP-direct actions like comments/reactions) is accepted
   * as a parameter since it is tracked externally.
   *
   * @param directCounts  Map of limit type ID → count of CDP-direct actions today.
   */
  getActionBudget(
    directCounts: ReadonlyMap<number, number> = new Map(),
  ): ActionBudgetEntry[] {
    const limitTypes = this.stmtLimitTypes.all() as unknown as LimitTypeRow[];
    const dailyLimits = this.stmtDailyLimits.all() as unknown as DailyLimitRow[];
    const todayCounts = this.stmtTodayCountsByType.all() as unknown as ActionCountRow[];

    // Build daily limit lookup: limit_type_id → max_limit
    const limitMap = new Map<number, number>();
    for (const dl of dailyLimits) {
      limitMap.set(dl.id, dl.max_limit);
    }

    // Build campaign usage lookup: limit_type_id → count
    const campaignUsageMap = new Map<number, number>();
    for (const row of todayCounts) {
      const limitTypeId = ACTION_TYPE_TO_LIMIT_TYPE.get(row.action_type);
      if (limitTypeId !== undefined) {
        const existing = campaignUsageMap.get(limitTypeId) ?? 0;
        campaignUsageMap.set(limitTypeId, existing + row.count_today);
      }
    }

    return limitTypes.map((lt) => {
      const dailyLimit = limitMap.get(lt.id) ?? null;
      const campaignUsed = campaignUsageMap.get(lt.id) ?? 0;
      const directUsed = directCounts.get(lt.id) ?? 0;
      const totalUsed = campaignUsed + directUsed;
      const remaining = dailyLimit !== null
        ? Math.max(0, dailyLimit - totalUsed)
        : null;

      return {
        limitTypeId: lt.id,
        limitType: lt.type,
        dailyLimit,
        campaignUsed,
        directUsed,
        totalUsed,
        remaining,
      };
    });
  }
}
