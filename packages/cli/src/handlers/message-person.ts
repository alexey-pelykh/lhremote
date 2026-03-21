// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  DEFAULT_CDP_PORT,
  errorMessage,
  messagePerson,
  type EphemeralActionResult,
  CampaignExecutionError,
  CampaignTimeoutError,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#message-person | message-person} CLI command. */
export async function handleMessagePerson(options: {
  personId?: number;
  url?: string;
  messageTemplate: string;
  subjectTemplate?: string;
  rejectIfReplied?: boolean;
  rejectIfMessaged?: boolean;
  keepCampaign?: boolean;
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

  let parsedMessageTemplate: Record<string, unknown>;
  try {
    parsedMessageTemplate = JSON.parse(options.messageTemplate) as Record<string, unknown>;
  } catch {
    process.stderr.write("Invalid JSON in --message-template.\n");
    process.exitCode = 1;
    return;
  }

  let parsedSubjectTemplate: Record<string, unknown> | undefined;
  if (options.subjectTemplate) {
    try {
      parsedSubjectTemplate = JSON.parse(options.subjectTemplate) as Record<string, unknown>;
    } catch {
      process.stderr.write("Invalid JSON in --subject-template.\n");
      process.exitCode = 1;
      return;
    }
  }

  process.stderr.write("Sending message...\n");

  let result: EphemeralActionResult;
  try {
    result = await messagePerson({
      personId: options.personId,
      url: options.url,
      messageTemplate: parsedMessageTemplate,
      subjectTemplate: parsedSubjectTemplate,
      rejectIfReplied: options.rejectIfReplied,
      rejectIfMessaged: options.rejectIfMessaged,
      keepCampaign: options.keepCampaign,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
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
    process.stdout.write(`Message ${result.success ? "sent" : "failed"} (person #${String(result.personId)})\n`);
  }
}
