// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { readFileSync } from "node:fs";

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  importPeopleFromUrls,
  type ImportPeopleFromUrlsOutput,
} from "@lhremote/core";

function parseUrls(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readUrlsFile(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  return content
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaign-targeting | import-people-from-urls} CLI command. */
export async function handleImportPeopleFromUrls(
  campaignId: number,
  options: {
    urls?: string;
    urlsFile?: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  // Reject conflicting options
  if (options.urls && options.urlsFile) {
    process.stderr.write("Use only one of --urls or --urls-file.\n");
    process.exitCode = 1;
    return;
  }

  // Parse URLs from options
  let linkedInUrls: string[];
  if (options.urls) {
    linkedInUrls = parseUrls(options.urls);
  } else if (options.urlsFile) {
    try {
      linkedInUrls = readUrlsFile(options.urlsFile);
    } catch (error) {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
  } else {
    process.stderr.write("Either --urls or --urls-file is required.\n");
    process.exitCode = 1;
    return;
  }

  if (linkedInUrls.length === 0) {
    process.stderr.write("No URLs provided.\n");
    process.exitCode = 1;
    return;
  }

  let result: ImportPeopleFromUrlsOutput;
  try {
    result = await importPeopleFromUrls({
      campaignId,
      linkedInUrls,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else if (error instanceof CampaignExecutionError) {
      process.stderr.write(
        `Failed to import people: ${error.message}\n`,
      );
    } else if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Imported ${String(result.imported)} people into campaign ${String(campaignId)} action ${String(result.actionId)}.` +
        (result.alreadyInQueue > 0
          ? ` ${String(result.alreadyInQueue)} already in queue.`
          : "") +
        (result.alreadyProcessed > 0
          ? ` ${String(result.alreadyProcessed)} already processed.`
          : "") +
        (result.failed > 0
          ? ` ${String(result.failed)} failed.`
          : "") +
        "\n",
    );
  }
}
