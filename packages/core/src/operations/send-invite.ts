// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionSettings, EphemeralActionResult } from "../types/index.js";
import {
  executeEphemeralAction,
  type EphemeralActionInput,
} from "./ephemeral-action.js";

export interface SendInviteInput extends EphemeralActionInput {
  readonly messageTemplate?: ActionSettings | undefined;
  readonly saveAsLeadSN?: boolean | undefined;
}

export type SendInviteOutput = EphemeralActionResult;

export async function sendInvite(
  input: SendInviteInput,
): Promise<SendInviteOutput> {
  const actionSettings: ActionSettings = {
    messageTemplate: input.messageTemplate ?? {
      type: "variants",
      variants: [],
    },
    saveAsLeadSN: input.saveAsLeadSN ?? false,
  };

  return executeEphemeralAction("InvitePerson", input, actionSettings);
}
