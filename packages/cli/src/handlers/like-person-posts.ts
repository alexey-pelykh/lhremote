// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  errorMessage,
  likePersonPosts,
  type EphemeralActionResult,
  CampaignExecutionError,
  CampaignTimeoutError,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#like-person-posts | like-person-posts} CLI command. */
export async function handleLikePersonPosts(options: {
  personId?: number;
  url?: string;
  numberOfArticles?: number;
  numberOfPosts?: number;
  maxAgeOfArticles?: number;
  maxAgeOfPosts?: number;
  shouldAddComment?: boolean;
  messageTemplate?: string;
  skipIfNotLiked?: boolean;
  keepCampaign?: boolean;
  timeout?: number;
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  accountId?: number;
  json?: boolean;
}): Promise<void> {
  if ((options.personId == null) === (options.url == null)) {
    process.stderr.write("Exactly one of --person-id or --url must be provided.\n");
    process.exitCode = 1;
    return;
  }

  let parsedMessageTemplate: Record<string, unknown> | undefined;
  if (options.messageTemplate) {
    try {
      parsedMessageTemplate = JSON.parse(options.messageTemplate) as Record<string, unknown>;
    } catch {
      process.stderr.write("Invalid JSON in --message-template.\n");
      process.exitCode = 1;
      return;
    }
  }

  process.stderr.write("Liking person posts...\n");

  let result: EphemeralActionResult;
  try {
    result = await likePersonPosts({
      personId: options.personId,
      url: options.url,
      numberOfArticles: options.numberOfArticles,
      numberOfPosts: options.numberOfPosts,
      maxAgeOfArticles: options.maxAgeOfArticles,
      maxAgeOfPosts: options.maxAgeOfPosts,
      shouldAddComment: options.shouldAddComment,
      messageTemplate: parsedMessageTemplate,
      skipIfNotLiked: options.skipIfNotLiked,
      keepCampaign: options.keepCampaign,
      timeout: options.timeout,
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
      accountId: options.accountId,
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
    process.stdout.write(`Like posts ${result.success ? "succeeded" : "failed"} (person #${String(result.personId)})\n`);
  }
}
