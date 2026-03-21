// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { Profile } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { ProfileRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface VisitProfileInput extends ConnectionOptions {
  readonly personId?: number | undefined;
  readonly url?: string | undefined;
  readonly extractCurrentOrganizations?: boolean | undefined;
}

export interface VisitProfileOutput {
  readonly success: true;
  readonly actionType: "VisitAndExtract";
  readonly profile: Profile;
}

const LINKEDIN_PROFILE_RE = /linkedin\.com\/in\/([^/?#]+)/;

function extractPublicId(url: string): string {
  const match = LINKEDIN_PROFILE_RE.exec(url);
  if (!match?.[1]) {
    throw new Error(
      `Invalid LinkedIn profile URL: ${url}. Expected format: https://www.linkedin.com/in/<public-id>`,
    );
  }
  return decodeURIComponent(match[1]);
}

export async function visitProfile(
  input: VisitProfileInput,
): Promise<VisitProfileOutput> {
  if ((input.personId == null) === (input.url == null)) {
    throw new Error("Exactly one of personId or url must be provided");
  }

  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    const repo = new ProfileRepository(db);

    let personId: number;
    if (input.personId != null) {
      personId = input.personId;
    } else {
      const publicId = extractPublicId(input.url as string);
      const existing = repo.findByPublicId(publicId);
      personId = existing.id;
    }

    await instance.executeAction("VisitAndExtract", {
      personIds: [personId],
      ...(input.extractCurrentOrganizations !== undefined && {
        extractCurrentOrganizations: input.extractCurrentOrganizations,
      }),
    });

    const profile = repo.findById(personId, { includePositions: true });

    return {
      success: true as const,
      actionType: "VisitAndExtract" as const,
      profile,
    };
  }, { instanceTimeout: 120_000 });
}
