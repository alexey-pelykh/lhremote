// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * A single limit type tracked by LinkedHelper.
 *
 * LinkedHelper defines 32 limit types (e.g. Invite, Message, Follow)
 * that correspond to LinkedIn action categories.
 */
export interface LimitType {
  readonly id: number;
  readonly type: string;
}

/**
 * Budget entry for a single limit type showing daily limits vs usage.
 */
export interface ActionBudgetEntry {
  /** LinkedHelper limit type ID. */
  readonly limitTypeId: number;
  /** Limit type name (e.g. "Invite", "Message", "Follow"). */
  readonly limitType: string;
  /** Maximum actions allowed per day, or `null` if no limit is configured. */
  readonly dailyLimit: number | null;
  /** Actions executed today via LH campaigns (from `action_results`). */
  readonly campaignUsed: number;
  /** Actions executed today via CDP-direct calls (comments, reactions). */
  readonly directUsed: number;
  /** Total actions used today (`campaignUsed + directUsed`). */
  readonly totalUsed: number;
  /** Remaining actions before hitting the daily limit, or `null` if unlimited. */
  readonly remaining: number | null;
}

/**
 * Full action budget response combining all rate limit sources.
 */
export interface ActionBudget {
  /** Per-limit-type budget breakdown. */
  readonly entries: ActionBudgetEntry[];
  /** ISO 8601 timestamp when the budget was computed. */
  readonly asOf: string;
}

/**
 * LinkedHelper ThrottleDetector status.
 *
 * The ThrottleDetector is a binary safety net that detects when
 * LinkedIn is actively throttling the account (e.g. captchas,
 * rate limit responses).
 */
export interface ThrottleStatus {
  /** Whether LinkedIn is currently throttling the account. */
  readonly throttled: boolean;
  /** ISO 8601 timestamp when throttling was last detected, or `null`. */
  readonly since: string | null;
}
