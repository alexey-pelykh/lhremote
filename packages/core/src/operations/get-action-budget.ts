// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionBudget } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { ActionBudgetRepository } from "../db/index.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

export type GetActionBudgetInput = ConnectionOptions;

export type GetActionBudgetOutput = ActionBudget;

export async function getActionBudget(
  input: GetActionBudgetInput,
): Promise<GetActionBudgetOutput> {
  const cdpPort = input.cdpPort;

  const accountId = await resolveAccount(cdpPort, buildCdpOptions(input));

  return withDatabase(accountId, ({ db }) => {
    const repo = new ActionBudgetRepository(db);
    const entries = repo.getActionBudget();
    return {
      entries,
      asOf: new Date().toISOString(),
    };
  });
}
