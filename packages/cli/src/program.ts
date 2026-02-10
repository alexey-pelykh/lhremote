import { createRequire } from "node:module";

import { Command, InvalidArgumentError, Option } from "commander";

import {
  handleCampaignCreate,
  handleCampaignDelete,
  handleCampaignExport,
  handleCampaignGet,
  handleCampaignList,
  handleCampaignStart,
  handleCampaignStatus,
  handleCampaignStop,
  handleCheckReplies,
  handleCheckStatus,
  handleDescribeActions,
  handleFindApp,
  handleLaunchApp,
  handleListAccounts,
  handleQueryMessages,
  handleQueryProfile,
  handleQueryProfiles,
  handleScrapeMessagingHistory,
  handleQuitApp,
  handleStartInstance,
  handleStopInstance,
  handleVisitAndExtract,
} from "./handlers/index.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

/** Parse a string as a positive integer, throwing on invalid input. */
function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InvalidArgumentError(`Expected a positive integer, got "${value}".`);
  }
  return n;
}

/** Parse a string as a non-negative integer, throwing on invalid input. */
function parseNonNegativeInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError(
      `Expected a non-negative integer, got "${value}".`,
    );
  }
  return n;
}

/**
 * Create the CLI program with all subcommands registered.
 */
export function createProgram(): Command {
  const program = new Command()
    .name("lhremote")
    .description("CLI for LinkedHelper automation")
    .version(version);

  program
    .command("find-app")
    .description("Detect running LinkedHelper instances")
    .option("--json", "Output as JSON")
    .action(handleFindApp);

  program
    .command("launch-app")
    .description("Launch the LinkedHelper application")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .action(handleLaunchApp);

  program
    .command("quit-app")
    .description("Quit the LinkedHelper application")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .action(handleQuitApp);

  program
    .command("list-accounts")
    .description("List LinkedHelper accounts")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleListAccounts);

  program
    .command("start-instance")
    .description("Start a LinkedHelper instance")
    .argument("<accountId>", "Account ID to start", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .action(handleStartInstance);

  program
    .command("stop-instance")
    .description("Stop a LinkedHelper instance")
    .argument("<accountId>", "Account ID to stop", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .action(handleStopInstance);

  program
    .command("campaign-list")
    .description("List LinkedHelper campaigns")
    .option("--include-archived", "Include archived campaigns")
    .option("--json", "Output as JSON")
    .action(handleCampaignList);

  program
    .command("campaign-create")
    .description("Create a new campaign from YAML or JSON configuration")
    .option("--file <path>", "Path to campaign configuration file")
    .option("--yaml <config>", "Inline YAML campaign configuration")
    .option("--json-input <config>", "Inline JSON campaign configuration")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleCampaignCreate);

  program
    .command("campaign-get")
    .description("Get detailed campaign information")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleCampaignGet);

  program
    .command("campaign-delete")
    .description("Delete (archive) a campaign")
    .argument("<campaignId>", "Campaign ID to delete", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleCampaignDelete);

  program
    .command("campaign-export")
    .description("Export a campaign configuration as YAML or JSON")
    .argument("<campaignId>", "Campaign ID to export", parsePositiveInt)
    .addOption(
      new Option("--format <format>", "Export format")
        .choices(["yaml", "json"])
        .default("yaml"),
    )
    .option("--output <path>", "Output file path (default: stdout)")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .action(handleCampaignExport);

  program
    .command("campaign-status")
    .description("Check campaign execution status")
    .argument("<campaignId>", "Campaign ID to check", parsePositiveInt)
    .option("--include-results", "Include execution results")
    .option("--limit <n>", "Max results to show (default: 20)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleCampaignStatus);

  program
    .command("campaign-start")
    .description("Start a campaign with specified target persons")
    .argument("<campaignId>", "Campaign ID to start", parsePositiveInt)
    .option("--person-ids <ids>", "Comma-separated person IDs")
    .option("--person-ids-file <path>", "File containing person IDs")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleCampaignStart);

  program
    .command("campaign-stop")
    .description("Stop a running campaign")
    .argument("<campaignId>", "Campaign ID to stop", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleCampaignStop);

  program
    .command("describe-actions")
    .description("List available LinkedHelper action types")
    .option("--category <category>", "Filter by category (people, messaging, engagement, crm, workflow)")
    .option("--type <type>", "Get details for a specific action type")
    .option("--json", "Output as JSON")
    .action(handleDescribeActions);

  program
    .command("visit-and-extract")
    .description("Visit a LinkedIn profile and extract data")
    .argument("<profileUrl>", "LinkedIn profile URL")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option(
      "--poll-timeout <ms>",
      "Extraction timeout in milliseconds (default: 30000)",
      parsePositiveInt,
    )
    .option("--json", "Output as JSON")
    .action(handleVisitAndExtract);

  program
    .command("query-messages")
    .description("Query messaging history from the local database")
    .option("--person-id <id>", "Filter by person ID", parsePositiveInt)
    .option("--chat-id <id>", "Show specific conversation thread", parsePositiveInt)
    .option("--search <text>", "Search message text")
    .option("--limit <n>", "Max results (default: 20)", parsePositiveInt)
    .option("--offset <n>", "Pagination offset (default: 0)", parseNonNegativeInt)
    .option("--json", "Output as JSON")
    .action(handleQueryMessages);

  program
    .command("query-profile")
    .description("Look up a cached profile from the local database")
    .option("--person-id <id>", "Look up by internal person ID", parsePositiveInt)
    .option("--public-id <slug>", "Look up by LinkedIn public ID")
    .option("--json", "Output as JSON")
    .action(handleQueryProfile);

  program
    .command("query-profiles")
    .description("Search for profiles in the local database")
    .option("--query <text>", "Search name or headline")
    .option("--company <name>", "Filter by company")
    .option("--limit <n>", "Max results (default: 20)", parsePositiveInt)
    .option("--offset <n>", "Pagination offset (default: 0)", parseNonNegativeInt)
    .option("--json", "Output as JSON")
    .action(handleQueryProfiles);

  program
    .command("scrape-messaging-history")
    .description(
      "Scrape messaging history from LinkedIn into the local database",
    )
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleScrapeMessagingHistory);

  program
    .command("check-replies")
    .description("Check for new message replies from LinkedIn")
    .option("--since <timestamp>", "Only show replies after this ISO timestamp")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleCheckReplies);

  program
    .command("check-status")
    .description("Check LinkedHelper status")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleCheckStatus);

  return program;
}
