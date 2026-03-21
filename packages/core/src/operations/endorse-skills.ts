// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionSettings, EphemeralActionResult } from "../types/index.js";
import {
  executeEphemeralAction,
  type EphemeralActionInput,
} from "./ephemeral-action.js";

export interface EndorseSkillsInput extends EphemeralActionInput {
  readonly skillNames?: string[] | undefined;
  readonly limit?: number | undefined;
  readonly skipIfNotEndorsable?: boolean | undefined;
}

export type EndorseSkillsOutput = EphemeralActionResult;

export async function endorseSkills(
  input: EndorseSkillsInput,
): Promise<EndorseSkillsOutput> {
  const actionSettings: ActionSettings = {
    skipIfNotEndorsable: input.skipIfNotEndorsable ?? true,
    ...(input.skillNames !== undefined && { skillNames: input.skillNames }),
    ...(input.limit !== undefined && { limit: input.limit }),
  };

  return executeEphemeralAction("EndorseSkills", input, actionSettings);
}
