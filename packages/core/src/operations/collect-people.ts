// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { SourceType } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CollectionService } from "../services/collection.js";
import { CollectionError } from "../services/errors.js";
import { CampaignRepository } from "../db/index.js";
import { detectSourceType, validateSourceType } from "../services/source-type-registry.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";
import {
  monitorCollectingSaga,
  type MonitorCollectingSagaResult,
  type UnrecoverablePopup,
} from "./monitor-collecting-saga.js";
import { waitForLoggedInState } from "./wait-for-logged-in-state.js";

/**
 * Input for the collect-people operation.
 */
export interface CollectPeopleInput extends ConnectionOptions {
  /** LinkedIn page URL to collect people from. */
  readonly sourceUrl: string;
  /** Campaign to collect people into. */
  readonly campaignId: number;
  /** Maximum number of profiles to collect. */
  readonly limit?: number;
  /** Maximum number of pages to process. */
  readonly maxPages?: number;
  /** Number of results per page. */
  readonly pageSize?: number;
  /** Explicit source type to bypass URL detection. */
  readonly sourceType?: string;
  /**
   * When `true`, after firing the LH-internal collect saga, monitor the
   * saga to completion and auto-dismiss recoverable
   * `IncorrectContentStateError` popups (LH's transient retry noise — see
   * #792).  Default `false` preserves the historical fire-and-forget
   * contract: callers that want a quick return continue to poll
   * `campaign-status` for progress.
   *
   * When set, the operation BLOCKS until either the saga reaches idle or
   * {@link CollectPeopleInput.monitorTimeout} elapses.  Saga durations
   * are measured in minutes (≤9 min observed empirically), so callers
   * should size their own timeouts accordingly.
   */
  readonly monitor?: boolean;
  /** Timeout in ms for the saga monitor (default 600_000 — 10 min). Ignored when {@link CollectPeopleInput.monitor} is not `true`. */
  readonly monitorTimeout?: number;
}

/**
 * Output from the collect-people operation.
 */
export interface CollectPeopleOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly sourceType: SourceType;
  /** Total time the saga monitor ran, in ms.  Only populated when {@link CollectPeopleInput.monitor} is `true` and the saga reached idle. */
  readonly sagaDurationMs?: number;
  /** Number of polling iterations on which a recoverable popup was dismissed.  Only populated when {@link CollectPeopleInput.monitor} is `true`. */
  readonly recoveryEvents?: number;
  /** Total individual popups dismissed during the monitored saga.  Only populated when {@link CollectPeopleInput.monitor} is `true`. */
  readonly popupsDismissed?: number;
  /** Unrecoverable popups observed during the monitored saga, deduplicated by title.  Only populated when {@link CollectPeopleInput.monitor} is `true`. */
  readonly unrecoverablePopups?: readonly UnrecoverablePopup[];
}

/**
 * Orchestrate people collection from a LinkedIn page into a campaign.
 *
 * Detects the source type from the URL (or uses an explicit override),
 * then initiates collection via {@link CollectionService}. Returns
 * immediately — the caller should poll `campaign-status` to monitor
 * progress.
 *
 * @throws {CollectionError} if the source type is unknown or invalid.
 * @throws {CollectionBusyError} if the instance is not idle.
 */
export async function collectPeople(
  input: CollectPeopleInput,
): Promise<CollectPeopleOutput> {
  const cdpPort = input.cdpPort;

  // Resolve source type: explicit override or URL detection
  let sourceType: SourceType;
  if (input.sourceType !== undefined) {
    if (!validateSourceType(input.sourceType)) {
      throw new CollectionError(
        `Invalid source type: ${input.sourceType}`,
      );
    }
    sourceType = input.sourceType;
  } else {
    const detected = detectSourceType(input.sourceUrl);
    if (!detected) {
      throw new CollectionError(
        `Unrecognized source URL: ${input.sourceUrl} — cannot determine LinkedIn page type`,
      );
    }
    sourceType = detected;
  }

  const accountId = await resolveAccount(cdpPort, buildCdpOptions(input));

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    // Look up the first action in the campaign — the collect IPC call
    // requires an actionId to associate collected people with.
    const campaignRepo = new CampaignRepository(db);
    const actions = campaignRepo.getCampaignActions(input.campaignId);
    if (actions.length === 0) {
      throw new CollectionError(
        `Campaign ${String(input.campaignId)} has no actions — cannot collect people`,
      );
    }
    const firstAction = actions[0];
    if (!firstAction) {
      throw new CollectionError(
        `Campaign ${String(input.campaignId)} has no actions — cannot collect people`,
      );
    }
    const actionId = firstAction.id;

    await waitForLoggedInState(instance, { timeout: 60_000 });

    const collectionService = new CollectionService(instance);
    await collectionService.collect(input.sourceUrl, input.campaignId, actionId);

    let monitorResult: MonitorCollectingSagaResult | undefined;
    if (input.monitor === true) {
      monitorResult = await monitorCollectingSaga(
        instance,
        input.monitorTimeout !== undefined
          ? { timeout: input.monitorTimeout }
          : {},
      );
    }

    return {
      success: true as const,
      campaignId: input.campaignId,
      sourceType,
      ...(monitorResult && {
        sagaDurationMs: monitorResult.durationMs,
        recoveryEvents: monitorResult.recoveryEvents,
        popupsDismissed: monitorResult.popupsDismissed,
        unrecoverablePopups: monitorResult.unrecoverablePopups,
      }),
    };
  });
}
