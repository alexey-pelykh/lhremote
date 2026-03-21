// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionSettings, EphemeralActionResult } from "../types/index.js";
import {
  executeEphemeralAction,
  type EphemeralActionInput,
} from "./ephemeral-action.js";

/** Per-category enrichment toggle. */
export interface EnrichmentCategory {
  readonly shouldEnrich: boolean;
  readonly actualDate?: number | undefined;
  readonly types?: string[] | undefined;
}

export interface EnrichProfileInput extends EphemeralActionInput {
  readonly profileInfo?: EnrichmentCategory | undefined;
  readonly phones?: EnrichmentCategory | undefined;
  readonly emails?: EnrichmentCategory | undefined;
  readonly socials?: EnrichmentCategory | undefined;
  readonly companies?: EnrichmentCategory | undefined;
}

export type EnrichProfileOutput = EphemeralActionResult;

export async function enrichProfile(
  input: EnrichProfileInput,
): Promise<EnrichProfileOutput> {
  const defaults: EnrichmentCategory = { shouldEnrich: false };
  const actionSettings: ActionSettings = {
    profileInfo: input.profileInfo ?? defaults,
    phones: input.phones ?? defaults,
    emails: input.emails ?? { ...defaults, types: ["personal", "business"] },
    socials: input.socials ?? defaults,
    companies: input.companies ?? defaults,
  };

  return executeEphemeralAction("DataEnrichment", input, actionSettings);
}
