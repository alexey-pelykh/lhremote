// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionSettings, EphemeralActionResult } from "../types/index.js";
import {
  executeEphemeralAction,
  type EphemeralActionInput,
} from "./ephemeral-action.js";

export interface SendInmailInput extends EphemeralActionInput {
  readonly messageTemplate: ActionSettings;
  readonly subjectTemplate?: ActionSettings | undefined;
  readonly rejectIfReplied?: boolean | undefined;
  readonly proceedOnOutOfCredits?: boolean | undefined;
}

export type SendInmailOutput = EphemeralActionResult;

export async function sendInmail(
  input: SendInmailInput,
): Promise<SendInmailOutput> {
  const actionSettings: ActionSettings = {
    messageTemplate: input.messageTemplate,
    ...(input.subjectTemplate !== undefined && {
      subjectTemplate: input.subjectTemplate,
    }),
    ...(input.rejectIfReplied !== undefined && {
      rejectIfReplied: input.rejectIfReplied,
    }),
    ...(input.proceedOnOutOfCredits !== undefined && {
      proceedOnOutOfCredits: input.proceedOnOutOfCredits,
    }),
  };

  return executeEphemeralAction("InMail", input, actionSettings);
}
