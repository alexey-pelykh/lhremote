// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  enrichProfile,
  type EphemeralActionResult,
  CampaignExecutionError,
  CampaignTimeoutError,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#enrich-profile | enrich-profile} CLI command. */
export async function handleEnrichProfile(options: {
  personId?: number;
  url?: string;
  enrichProfileInfo?: boolean;
  enrichPhones?: boolean;
  enrichEmails?: boolean;
  enrichSocials?: boolean;
  enrichCompanies?: boolean;
  keepCampaign?: boolean;
  timeout?: number;
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  if ((options.personId == null) === (options.url == null)) {
    process.stderr.write("Exactly one of --person-id or --url must be provided.\n");
    process.exitCode = 1;
    return;
  }

  process.stderr.write("Enriching profile...\n");

  let result: EphemeralActionResult;
  try {
    result = await enrichProfile({
      personId: options.personId,
      url: options.url,
      profileInfo: options.enrichProfileInfo !== undefined
        ? { shouldEnrich: options.enrichProfileInfo } : undefined,
      phones: options.enrichPhones !== undefined
        ? { shouldEnrich: options.enrichPhones } : undefined,
      emails: options.enrichEmails !== undefined
        ? { shouldEnrich: options.enrichEmails, types: ["personal", "business"] } : undefined,
      socials: options.enrichSocials !== undefined
        ? { shouldEnrich: options.enrichSocials } : undefined,
      companies: options.enrichCompanies !== undefined
        ? { shouldEnrich: options.enrichCompanies } : undefined,
      keepCampaign: options.keepCampaign,
      timeout: options.timeout,
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignExecutionError || error instanceof CampaignTimeoutError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`${errorMessage(error)}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stderr.write("Done.\n");

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(`Enrichment ${result.success ? "succeeded" : "failed"} (person #${String(result.personId)})\n`);
  }
}
