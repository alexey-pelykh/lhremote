// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { MessageStats } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CampaignService } from "../services/campaign.js";
import { CampaignTimeoutError } from "../services/errors.js";
import { MessageRepository, ProfileRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import { delay } from "../utils/delay.js";
import type { ConnectionOptions } from "./types.js";

/** Timeout for ephemeral campaign completion (5 minutes). */
const CAMPAIGN_TIMEOUT = 300_000;

/** Interval between campaign status polls (2 seconds). */
const POLL_INTERVAL = 2_000;

export interface ScrapeMessagingHistoryInput extends ConnectionOptions {
  readonly personIds: number[];
}

export interface ScrapeMessagingHistoryOutput {
  readonly success: true;
  readonly actionType: "ScrapeMessagingHistory";
  readonly stats: MessageStats;
}

export async function scrapeMessagingHistory(
  input: ScrapeMessagingHistoryInput,
): Promise<ScrapeMessagingHistoryOutput> {
  if (input.personIds.length === 0) {
    throw new Error("At least one personId is required");
  }

  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const campaignService = new CampaignService(instance, db);
    const profileRepo = new ProfileRepository(db);

    // Resolve person IDs to LinkedIn profile URLs
    const profiles = profileRepo.findByIds(input.personIds);
    const linkedInUrls: string[] = [];
    for (let i = 0; i < input.personIds.length; i++) {
      const personId = input.personIds[i] as number;
      const profile = profiles[i];
      if (!profile) {
        throw new Error(`Person ${String(personId)} not found in database`);
      }
      const publicId = profile.externalIds.find((e) => e.typeGroup === "public");
      if (!publicId) {
        throw new Error(`Person ${String(personId)} has no LinkedIn public ID`);
      }
      linkedInUrls.push(`https://www.linkedin.com/in/${publicId.externalId}`);
    }

    // Create ephemeral campaign with ScrapeMessagingHistory action
    const campaign = await campaignService.create({
      name: `[ephemeral] ScrapeMessagingHistory ${new Date().toISOString()}`,
      actions: [{
        name: "ScrapeMessagingHistory",
        actionType: "ScrapeMessagingHistory",
        coolDown: 0,
        maxActionResultsPerIteration: input.personIds.length,
      }],
    });

    try {
      // Import target persons into campaign
      await campaignService.importPeopleFromUrls(campaign.id, linkedInUrls);

      // Start campaign runner
      await campaignService.start(campaign.id, []);

      // Poll for completion (runner idle + no queued persons)
      const deadline = Date.now() + CAMPAIGN_TIMEOUT;
      let completed = false;
      while (Date.now() < deadline) {
        const status = await campaignService.getStatus(campaign.id);
        const counts = status.actionCounts[0];
        if (status.runnerState === "idle" && counts && counts.queued === 0) {
          completed = true;
          break;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await delay(Math.min(POLL_INTERVAL, remaining));
      }

      if (!completed) {
        throw new CampaignTimeoutError(
          `ScrapeMessagingHistory did not complete within ${String(CAMPAIGN_TIMEOUT)}ms`,
          campaign.id,
        );
      }

      // Read message stats from database
      const repo = new MessageRepository(db);
      const stats = repo.getMessageStats();

      return {
        success: true as const,
        actionType: "ScrapeMessagingHistory" as const,
        stats,
      };
    } finally {
      try { await campaignService.stop(campaign.id); } catch { /* best-effort cleanup */ }
      try { campaignService.hardDelete(campaign.id); } catch { /* best-effort cleanup */ }
    }
  }, { instanceTimeout: CAMPAIGN_TIMEOUT });
}
