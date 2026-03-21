// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { Profile } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { ProfileRepository } from "../db/index.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

export interface VisitProfileInput extends ConnectionOptions {
  readonly personId: number;
  readonly extractCurrentOrganizations?: boolean | undefined;
}

export interface VisitProfileOutput {
  readonly success: true;
  readonly actionType: "VisitAndExtract";
  readonly profile: Profile;
}

export async function visitProfile(
  input: VisitProfileInput,
): Promise<VisitProfileOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const accountId = await resolveAccount(cdpPort, {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  });

  return withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
    await instance.executeAction("VisitAndExtract", {
      personIds: [input.personId],
      ...(input.extractCurrentOrganizations !== undefined && {
        extractCurrentOrganizations: input.extractCurrentOrganizations,
      }),
    });

    const repo = new ProfileRepository(db);
    const profile = repo.findById(input.personId, { includePositions: true });

    return {
      success: true as const,
      actionType: "VisitAndExtract" as const,
      profile,
    };
  }, { instanceTimeout: 120_000 });
}
