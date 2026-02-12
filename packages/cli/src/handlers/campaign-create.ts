import { readFileSync } from "node:fs";

import {
  type CampaignConfig,
  CampaignExecutionError,
  CampaignFormatError,
  CampaignService,
  errorMessage,
  InstanceNotRunningError,
  parseCampaignJson,
  parseCampaignYaml,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#campaigns | campaign-create} CLI command. */
export async function handleCampaignCreate(options: {
  file?: string;
  yaml?: string;
  jsonInput?: string;
  cdpPort?: number;
  json?: boolean;
}): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;

  // Validate input options
  const inputCount = [options.file, options.yaml, options.jsonInput].filter(
    Boolean,
  ).length;
  if (inputCount === 0) {
    process.stderr.write(
      "One of --file, --yaml, or --json-input is required.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (inputCount > 1) {
    process.stderr.write(
      "Use only one of --file, --yaml, or --json-input.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Read and parse config
  let config: CampaignConfig;
  try {
    if (options.file) {
      const content = readFileSync(options.file, "utf-8");
      // Detect format from extension
      const isJson = options.file.endsWith(".json");
      config = isJson
        ? parseCampaignJson(content)
        : parseCampaignYaml(content);
    } else if (options.jsonInput) {
      config = parseCampaignJson(options.jsonInput);
    } else {
      // options.yaml is guaranteed to be set by inputCount validation
      config = parseCampaignYaml(options.yaml as string);
    }
  } catch (error) {
    if (error instanceof CampaignFormatError) {
      process.stderr.write(
        `Invalid campaign configuration: ${error.message}\n`,
      );
    } else {
      const message = errorMessage(error);
      process.stderr.write(
        `Failed to parse campaign configuration: ${message}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  let accountId: number;
  try {
    accountId = await resolveAccount(cdpPort);
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
      const campaignService = new CampaignService(instance, db);
      const campaign = await campaignService.create(config);

      if (options.json) {
        process.stdout.write(JSON.stringify(campaign, null, 2) + "\n");
      } else {
        process.stdout.write(
          `Campaign created: #${campaign.id} "${campaign.name}"\n`,
        );
      }
    });
  } catch (error) {
    if (error instanceof CampaignExecutionError) {
      process.stderr.write(`Failed to create campaign: ${error.message}\n`);
    } else if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}
