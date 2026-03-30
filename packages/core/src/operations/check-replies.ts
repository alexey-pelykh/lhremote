// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ConversationMessages } from "../types/index.js";
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

export interface CheckRepliesInput extends ConnectionOptions {
  readonly personIds: number[];
  readonly since?: string | undefined;
  readonly pauseOthers?: boolean | undefined;
}

export interface CheckRepliesOutput {
  readonly newMessages: ConversationMessages[];
  readonly totalNew: number;
  readonly checkedAt: string;
}

export async function checkReplies(
  input: CheckRepliesInput,
): Promise<CheckRepliesOutput> {
  if (input.personIds.length === 0) {
    throw new Error("At least one personId is required");
  }

  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;
  const cutoff =
    input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

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

    let runnerWasActive = false;
    let campaign: { id: number } | undefined;
    let pausedCampaignIds: number[] = [];
    try {
      // Capture runner state and stop if active to avoid SQLite lock contention
      runnerWasActive = (await campaignService.getRunnerState()) !== "idle";
      await campaignService.stopRunnerAndWaitForIdle();
      // Create ephemeral campaign with CheckForReplies action
      campaign = await campaignService.create({
        name: `[ephemeral] CheckForReplies ${new Date().toISOString()}`,
        actions: [{
          name: "CheckForReplies",
          actionType: "CheckForReplies",
          coolDown: 0,
          maxActionResultsPerIteration: input.personIds.length,
          actionSettings: {
            moveToSuccessfulAfterMs: 1_000,
            treatMessageAcceptedAsReply: false,
            keepInQueueIfRequestIsNotAccepted: false,
          },
        }],
      });

      // Pause other campaigns if requested (restore in finally)
      if (input.pauseOthers) {
        pausedCampaignIds = await campaignService.pauseAllExcept(campaign.id);
      }

      // Import target persons into campaign
      await campaignService.importPeopleFromUrls(campaign.id, linkedInUrls);

      // Start the campaign: wait for idle, unpause, start runner
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
          `CheckForReplies did not complete within ${String(CAMPAIGN_TIMEOUT)}ms`,
          campaign.id,
        );
      }

      // Read new messages from database, filtered to requested persons
      const repo = new MessageRepository(db);
      const conversations = repo.getMessagesSince(cutoff);
      const personIdSet = new Set(input.personIds);
      const filtered = conversations.filter(
        (c) => personIdSet.has(c.personId),
      );
      const totalNew = filtered.reduce(
        (sum, c) => sum + c.messages.length,
        0,
      );

      return {
        newMessages: filtered,
        totalNew,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      // Stop runner first so DB writes don't contend with it
      try { await campaignService.stopRunnerAndWaitForIdle(); } catch { /* best-effort */ }
      if (campaign) {
        try { await campaignService.stop(campaign.id); } catch { /* best-effort cleanup */ }
        try { campaignService.hardDelete(campaign.id); } catch { /* best-effort cleanup */ }
      }
      if (pausedCampaignIds.length > 0) {
        try { await campaignService.unpauseCampaigns(pausedCampaignIds); } catch { /* best-effort restore */ }
      }
      if (runnerWasActive) {
        try { await campaignService.startRunner(); } catch { /* best-effort restore */ }
      }
    }
  }, { instanceTimeout: CAMPAIGN_TIMEOUT, db: { readOnly: false } });
}
