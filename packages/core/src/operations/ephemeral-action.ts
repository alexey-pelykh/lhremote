// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionSettings, EphemeralActionResult } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { EphemeralCampaignService } from "../services/ephemeral-campaign.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

/**
 * Shared input fields for all ephemeral action operations.
 *
 * Each individual action operation extends this with action-specific
 * parameters.
 */
export interface EphemeralActionInput extends ConnectionOptions {
  readonly personId?: number | undefined;
  readonly url?: string | undefined;
  readonly keepCampaign?: boolean | undefined;
}

/**
 * Execute a single action on a single person via the ephemeral campaign
 * service.
 *
 * Shared helper used by all individual action operations
 * (message-person, send-invite, etc.).
 */
export async function executeEphemeralAction(
  actionType: string,
  input: EphemeralActionInput,
  actionSettings?: ActionSettings,
): Promise<EphemeralActionResult> {
  if ((input.personId == null) === (input.url == null)) {
    throw new Error("Exactly one of personId or url must be provided");
  }

  const target: number | string = input.personId ?? (input.url as string);
  const cdpPort = input.cdpPort;

  const accountId = await resolveAccount(cdpPort, buildCdpOptions(input));

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const ephemeral = new EphemeralCampaignService(instance, db);
    return ephemeral.execute(actionType, target, actionSettings, {
      ...(input.keepCampaign !== undefined && { keepCampaign: input.keepCampaign }),
    });
  });
}
