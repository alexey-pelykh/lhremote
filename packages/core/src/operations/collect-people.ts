// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { SourceType } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { CollectionService } from "../services/collection.js";
import { CollectionError } from "../services/errors.js";
import { detectSourceType, validateSourceType } from "../services/source-type-registry.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

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
}

/**
 * Output from the collect-people operation.
 */
export interface CollectPeopleOutput {
  readonly success: true;
  readonly campaignId: number;
  readonly sourceType: SourceType;
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

  return withInstanceDatabase(cdpPort, accountId, async ({ instance }) => {
    const collectionService = new CollectionService(instance);
    await collectionService.collect(input.sourceUrl, input.campaignId, {
      ...(input.limit !== undefined && { limit: input.limit }),
      ...(input.maxPages !== undefined && { maxPages: input.maxPages }),
      ...(input.pageSize !== undefined && { pageSize: input.pageSize }),
    });

    return {
      success: true as const,
      campaignId: input.campaignId,
      sourceType,
    };
  });
}
