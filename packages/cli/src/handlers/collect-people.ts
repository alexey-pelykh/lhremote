// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  CollectionBusyError,
  CollectionError,
  DEFAULT_CDP_PORT,
  collectPeople,
  errorMessage,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#collect-people | collect-people} CLI command. */
export async function handleCollectPeople(
  campaignId: number,
  sourceUrl: string,
  options: {
    limit?: number;
    maxPages?: number;
    pageSize?: number;
    sourceType?: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  try {
    const result = await collectPeople({
      campaignId,
      sourceUrl,
      ...(options.limit !== undefined && { limit: options.limit }),
      ...(options.maxPages !== undefined && { maxPages: options.maxPages }),
      ...(options.pageSize !== undefined && { pageSize: options.pageSize }),
      ...(options.sourceType !== undefined && { sourceType: options.sourceType }),
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      ...(options.cdpHost !== undefined && { cdpHost: options.cdpHost }),
      ...(options.allowRemote !== undefined && { allowRemote: options.allowRemote }),
    });

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Started collecting people (${result.sourceType}) into campaign ${String(campaignId)}.\n`,
      );
    }
  } catch (error) {
    if (error instanceof CollectionBusyError) {
      process.stderr.write(
        `Cannot collect — instance is busy (state: ${error.runnerState}).\n`,
      );
    } else if (error instanceof CollectionError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}
