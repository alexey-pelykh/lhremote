// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { EphemeralActionResult } from "../types/index.js";
import {
  executeEphemeralAction,
  type EphemeralActionInput,
} from "./ephemeral-action.js";

export type RemoveConnectionInput = EphemeralActionInput;

export type RemoveConnectionOutput = EphemeralActionResult;

export async function removeConnection(
  input: RemoveConnectionInput,
): Promise<RemoveConnectionOutput> {
  return executeEphemeralAction("RemoveFromFirstConnection", input);
}
