// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { writeFileSync } from "node:fs";

import {
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  campaignExport,
  type CampaignExportOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-export} CLI command. */
export async function handleCampaignExport(
  campaignId: number,
  options: {
    format?: string;
    output?: string;
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
  },
): Promise<void> {
  const format = options.format ?? "yaml";

  if (format !== "yaml" && format !== "json") {
    process.stderr.write(
      `Unsupported format "${format}". Use "yaml" or "json".\n`,
    );
    process.exitCode = 1;
    return;
  }

  let result: CampaignExportOutput;
  try {
    result = await campaignExport({
      campaignId,
      format,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof CampaignNotFoundError) {
      process.stderr.write(`Campaign ${String(campaignId)} not found.\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (options.output) {
    writeFileSync(options.output, result.config, "utf-8");
    process.stdout.write(
      `Campaign ${String(campaignId)} exported to ${options.output}\n`,
    );
  } else {
    process.stdout.write(result.config.endsWith("\n") ? result.config : `${result.config}\n`);
  }
}
