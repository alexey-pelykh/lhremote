// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { ActionBudgetRepository } from "../db/index.js";
import { resolveAccount } from "./account-resolution.js";
import { BudgetExceededError } from "./errors.js";
import { withDatabase } from "./instance-context.js";

/**
 * Read LinkedHelper's action budget and refuse when the given limit type
 * is exhausted.
 *
 * CDP-direct write operations drive LinkedIn through the webview instead of
 * through LinkedHelper's own action pipeline, so nothing upstream stops them
 * from spending a budget LinkedHelper believes is intact.  This is the
 * pre-flight half of that: it consults the same `limit_types` / `daily_limits`
 * / `action_results` reading `get-action-budget` reports and raises before any
 * navigation happens (#569).
 *
 * **Read-only, and deliberately so.**  Debiting the budget afterwards — the
 * INSERT into `action_results` that would make LinkedHelper's own scheduler
 * see the spend — is NOT done here and is tracked separately.  Every
 * `action_results` shape in this repository is a test fixture, which defines
 * what the suite sees and never what a real LinkedHelper install has, so a
 * CI-green INSERT would attest to nothing about the table it would actually
 * write to.  Until that shape is confirmed against a licensed install, the
 * check is worth having on its own and the debit is not worth guessing at.
 *
 * Three states, and only the first refuses:
 *
 * - the entry exists, declares a daily limit, and has no remaining headroom —
 *   raise {@link BudgetExceededError}.
 * - the entry exists with `remaining: null` — LinkedHelper configures no daily
 *   limit for that type, so there is no ceiling to be over. Proceed.
 * - no entry for this limit type at all — the account's `limit_types` table
 *   does not carry it. Proceed rather than refuse: an absent row is the
 *   database declining to speak, not a zero budget, and treating silence as a
 *   refusal would block the operation outright on any install whose schema
 *   does not enumerate this type.
 *
 * The budget is read *before* the operation acts, so a caller that ultimately
 * performs no write (a dry run, or a no-op the operation discovers later) is
 * still refused when the budget is gone. That is intentional and is what the
 * sibling operations already do: a dry run answers "what would happen", and
 * with the budget exhausted what would happen is this refusal.
 *
 * **Two bounds this does not close**, both inherited from the collaborators it
 * calls rather than introduced here, and both stated so a caller does not read
 * a clean return as more than it is:
 *
 * - **The verdict is local even when the target is not.** `resolveAccount`
 *   takes a host; `withDatabase` does not — `discoverDatabase` builds its path
 *   from `homedir()`. Against a remote instance (`--allow-remote` with a
 *   non-loopback host) the reaction happens there and the budget is read here,
 *   so the answer can be confidently wrong in both directions. `comment-on-post`
 *   has consulted the budget this way since it landed; this helper inherits the
 *   behaviour unchanged rather than diverging from it silently.
 * - **`max_limit = 0` is read as exhausted.** Nothing in this repository
 *   establishes whether LinkedHelper writes `0` to mean *disabled* — in which
 *   case refusing is right — or *no limit*, in which case it is a permanent
 *   lockout. Same class of unknown as the limit type ids above, same remedy: a
 *   read from a licensed install.
 *
 * @param limitTypeId - LinkedHelper `limit_types.id` this operation spends.
 * @param cdpPort - CDP port to resolve the account through; `undefined`
 *   auto-discovers it.
 * @param options - Connection options, per {@link resolveAccount}. Build with
 *   `buildCdpOptions` so an explicit `accountId` short-circuits discovery.
 * @throws {BudgetExceededError} when the limit type has no headroom left.
 */
export async function assertActionBudget(
  limitTypeId: number,
  cdpPort: number | undefined,
  options: { host?: string; allowRemote?: boolean; accountId?: number },
): Promise<void> {
  const accountId = await resolveAccount(cdpPort, options);

  await withDatabase(accountId, ({ db }) => {
    const repo = new ActionBudgetRepository(db);
    const entry = repo
      .getActionBudget()
      .find((e) => e.limitTypeId === limitTypeId);

    if (entry && entry.remaining !== null && entry.remaining <= 0) {
      throw new BudgetExceededError(
        entry.limitType,
        entry.dailyLimit ?? 0,
        entry.totalUsed,
      );
    }
  });
}
