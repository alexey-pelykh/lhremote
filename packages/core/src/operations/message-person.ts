// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionSettings, EphemeralActionResult } from "../types/index.js";
import {
  executeEphemeralAction,
  type EphemeralActionInput,
} from "./ephemeral-action.js";

export interface MessagePersonInput extends EphemeralActionInput {
  readonly messageTemplate: ActionSettings;
  readonly subjectTemplate?: ActionSettings | undefined;
  readonly rejectIfReplied?: boolean | undefined;
  readonly rejectIfMessaged?: boolean | undefined;
}

export type MessagePersonOutput = EphemeralActionResult;

export async function messagePerson(
  input: MessagePersonInput,
): Promise<MessagePersonOutput> {
  const actionSettings: ActionSettings = {
    messageTemplate: input.messageTemplate,
    ...(input.subjectTemplate !== undefined && {
      subjectTemplate: input.subjectTemplate,
    }),
    ...(input.rejectIfReplied !== undefined && {
      rejectIfReplied: input.rejectIfReplied,
    }),
    ...(input.rejectIfMessaged !== undefined && {
      rejectIfMessaged: input.rejectIfMessaged,
    }),
  };

  return executeEphemeralAction("MessageToPerson", input, actionSettings);
}
