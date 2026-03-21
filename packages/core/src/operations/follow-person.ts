// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionSettings, EphemeralActionResult } from "../types/index.js";
import {
  executeEphemeralAction,
  type EphemeralActionInput,
} from "./ephemeral-action.js";

export interface FollowPersonInput extends EphemeralActionInput {
  readonly mode?: "follow" | "unfollow" | undefined;
  readonly skipIfUnfollowable?: boolean | undefined;
}

export type FollowPersonOutput = EphemeralActionResult;

export async function followPerson(
  input: FollowPersonInput,
): Promise<FollowPersonOutput> {
  const actionSettings: ActionSettings = {
    skipIfUnfollowable: input.skipIfUnfollowable ?? true,
    ...(input.mode !== undefined && { mode: input.mode }),
  };

  return executeEphemeralAction("Follow", input, actionSettings);
}
