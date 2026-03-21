// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type {
  ActionSettings,
  EphemeralActionResult,
  EphemeralExecuteOptions,
} from "../types/index.js";
import type { DatabaseClient } from "../db/index.js";
import { ProfileRepository } from "../db/index.js";
import { delay } from "../utils/delay.js";
import type { InstanceService } from "./instance.js";
import { CampaignService } from "./campaign.js";
import { CampaignExecutionError, CampaignTimeoutError } from "./errors.js";

/** Default timeout for ephemeral action execution (5 minutes). */
const DEFAULT_TIMEOUT = 300_000;

/** Default interval between status polls (2 seconds). */
const DEFAULT_POLL_INTERVAL = 2_000;

/** Prefix for ephemeral campaign names. */
const CAMPAIGN_NAME_PREFIX = "[ephemeral]";

/**
 * Executes a single LinkedHelper action on a single person without
 * manual campaign setup.
 *
 * Creates a temporary campaign, adds the requested action, imports the
 * target person, starts the campaign runner, polls for completion,
 * extracts the result, then hard-deletes the campaign (or archives it
 * if `keepCampaign: true`).
 */
export class EphemeralCampaignService {
  private readonly campaignService: CampaignService;
  private readonly profileRepo: ProfileRepository;

  constructor(instance: InstanceService, db: DatabaseClient) {
    this.campaignService = new CampaignService(instance, db);
    this.profileRepo = new ProfileRepository(db);
  }

  /**
   * Execute a single action on a single person using a temporary campaign.
   *
   * @param actionType - Action type identifier (e.g., 'MessageToPerson', 'InvitePerson').
   * @param target - Person ID (number) or LinkedIn profile URL (string).
   * @param actionSettings - Action-specific settings (e.g., message template).
   * @param options - Execution options (timeout, keepCampaign, etc.).
   * @returns Action result with success status, person ID, and action results.
   *
   * @throws {CampaignExecutionError} if the target cannot be resolved, import fails,
   *   or the campaign cannot be started.
   * @throws {CampaignTimeoutError} if the action does not complete within the timeout.
   */
  async execute(
    actionType: string,
    target: number | string,
    actionSettings?: ActionSettings,
    options?: EphemeralExecuteOptions,
  ): Promise<EphemeralActionResult> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
    const keepCampaign = options?.keepCampaign ?? false;

    // Step 1: Resolve target to LinkedIn URL and person ID (if known)
    const resolved = this.resolveTarget(target);

    // Step 2: Create temporary campaign
    const campaign = await this.campaignService.create({
      name: `${CAMPAIGN_NAME_PREFIX} ${actionType} ${new Date().toISOString()}`,
      actions: [
        {
          name: actionType,
          actionType,
          ...(actionSettings !== undefined && { actionSettings }),
          coolDown: 0,
          maxActionResultsPerIteration: 1,
        },
      ],
    });

    try {
      // Step 3: Import target person
      const importResult = await this.campaignService.importPeopleFromUrls(
        campaign.id,
        [resolved.linkedInUrl],
      );

      if (importResult.successful === 0 && importResult.alreadyInQueue === 0 && importResult.alreadyProcessed === 0) {
        throw new CampaignExecutionError(
          `Failed to import target into campaign: ${resolved.linkedInUrl}`,
          campaign.id,
        );
      }

      // Resolve person ID if not yet known (URL-based target)
      const personId = resolved.personId ?? this.resolvePersonIdFromUrl(resolved.linkedInUrl);

      // Step 4: Start campaign
      await this.campaignService.start(campaign.id, []);

      // Step 5: Poll for completion
      await this.pollForCompletion(campaign.id, timeout, pollInterval);

      // Step 6: Get results
      const runResult = await this.campaignService.getResults(campaign.id);
      const results = runResult.results;
      const success = results.some((r) => r.result > 0);

      // Step 7: Cleanup
      await this.cleanup(campaign.id, keepCampaign);

      return {
        success,
        personId,
        results,
        ...(keepCampaign && { campaignId: campaign.id }),
      };
    } catch (error) {
      await this.cleanup(campaign.id, keepCampaign);
      throw error;
    }
  }

  /**
   * Resolve a target (person ID or URL) to a LinkedIn URL and optional person ID.
   */
  private resolveTarget(target: number | string): {
    linkedInUrl: string;
    personId: number | undefined;
  } {
    if (typeof target === "number") {
      // Person ID → look up LinkedIn URL from profile
      const profiles = this.profileRepo.findByIds([target]);
      const profile = profiles[0];
      if (!profile) {
        throw new CampaignExecutionError(
          `Person ${String(target)} not found in database`,
        );
      }

      const publicId = profile.externalIds.find(
        (e) => e.typeGroup === "public",
      );
      if (!publicId) {
        throw new CampaignExecutionError(
          `Person ${String(target)} has no LinkedIn public ID`,
        );
      }

      return {
        linkedInUrl: `https://www.linkedin.com/in/${publicId.externalId}`,
        personId: target,
      };
    }

    // String target → validate and normalize LinkedIn URL; person ID resolved after import
    const slug = this.extractSlug(target);
    return {
      linkedInUrl: `https://www.linkedin.com/in/${slug}`,
      personId: undefined,
    };
  }

  /**
   * Resolve person ID from a LinkedIn profile URL after import.
   */
  private resolvePersonIdFromUrl(linkedInUrl: string): number {
    const slug = this.extractSlug(linkedInUrl);
    try {
      const profile = this.profileRepo.findByPublicId(slug);
      return profile.id;
    } catch (cause) {
      throw new CampaignExecutionError(
        `Could not resolve person ID for ${linkedInUrl} after import`,
        undefined,
        { cause: cause instanceof Error ? cause : undefined },
      );
    }
  }

  /**
   * Extract the LinkedIn public ID (slug) from a profile URL.
   */
  private extractSlug(url: string): string {
    const match = /linkedin\.com\/in\/([^/?#]+)/.exec(url);
    if (!match?.[1]) {
      throw new CampaignExecutionError(
        `Invalid LinkedIn profile URL: ${url}`,
      );
    }
    return match[1];
  }

  /**
   * Poll campaign status until the target person's action completes or times out.
   */
  private async pollForCompletion(
    campaignId: number,
    timeout: number,
    pollInterval: number,
  ): Promise<void> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const status = await this.campaignService.getStatus(campaignId);
      const counts = status.actionCounts[0];

      // Action complete when at least one person is successful or failed
      if (counts && (counts.successful > 0 || counts.failed > 0)) {
        return;
      }

      // Runner returned to idle with no queued people — action is done
      if (status.runnerState === "idle" && counts && counts.queued === 0) {
        return;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(pollInterval, remaining));
    }

    throw new CampaignTimeoutError(
      `Ephemeral action did not complete within ${String(timeout)}ms`,
      campaignId,
    );
  }

  /**
   * Stop and remove/archive an ephemeral campaign (best-effort).
   */
  private async cleanup(campaignId: number, keepCampaign: boolean): Promise<void> {
    await this.safeStop(campaignId);

    if (keepCampaign) {
      await this.safeArchive(campaignId);
    } else {
      this.safeHardDelete(campaignId);
    }
  }

  /**
   * Stop campaign without throwing on failure.
   */
  private async safeStop(campaignId: number): Promise<void> {
    try {
      await this.campaignService.stop(campaignId);
    } catch {
      // Best-effort cleanup — campaign may already be stopped
    }
  }

  /**
   * Archive campaign without throwing on failure.
   */
  private async safeArchive(campaignId: number): Promise<void> {
    try {
      await this.campaignService.delete(campaignId);
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Hard-delete campaign without throwing on failure.
   */
  private safeHardDelete(campaignId: number): void {
    try {
      this.campaignService.hardDelete(campaignId);
    } catch {
      // Best-effort cleanup
    }
  }
}
