// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CampaignPersonEntry, CampaignPersonState } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CampaignRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the campaign-list-people operation.
 */
export interface CampaignListPeopleInput extends ConnectionOptions {
  readonly campaignId: number;
  readonly actionId?: number | undefined;
  readonly status?: CampaignPersonState | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

/**
 * Output from the campaign-list-people operation.
 */
export interface CampaignListPeopleOutput {
  readonly campaignId: number;
  readonly people: CampaignPersonEntry[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * List people assigned to a campaign with optional filtering and pagination.
 *
 * This is the shared business logic used by both the CLI handler and
 * the MCP tool.
 */
export async function campaignListPeople(
  input: CampaignListPeopleInput,
): Promise<CampaignListPeopleOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withDatabase(accountId, ({ db }) => {
    const campaignRepo = new CampaignRepository(db);
    const result = campaignRepo.listPeople(input.campaignId, {
      ...(input.actionId !== undefined && { actionId: input.actionId }),
      ...(input.status !== undefined && { status: input.status }),
      limit,
      offset,
    });

    return {
      campaignId: input.campaignId,
      people: result.people,
      total: result.total,
      limit,
      offset,
    };
  });
}
