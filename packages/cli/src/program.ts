// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { createRequire } from "node:module";

import { Command, InvalidArgumentError, Option } from "commander";

import {
  handleAddPeopleToCollection,
  handleBuildUrl,
  handleCampaignAddAction,
  handleCampaignCreate,
  handleCampaignDelete,
  handleCampaignErase,
  handleCampaignExcludeAdd,
  handleCampaignExcludeList,
  handleCampaignExcludeRemove,
  handleCampaignExport,
  handleCampaignGet,
  handleCampaignList,
  handleCampaignListPeople,
  handleCampaignMoveNext,
  handleCampaignRemoveAction,
  handleCampaignRemovePeople,
  handleCampaignReorderActions,
  handleCampaignRetry,
  handleCampaignStart,
  handleCampaignStatistics,
  handleCampaignStatus,
  handleCampaignStop,
  handleCampaignUpdate,
  handleCampaignUpdateAction,
  handleCreateCollection,
  handleDeleteCollection,
  handleDismissFeedPost,
  handleDismissErrors,
  handleImportPeopleFromCollection,
  handleImportPeopleFromUrls,
  handleListCollections,
  handleCheckReplies,
  handleCheckStatus,
  handleCommentOnPost,
  handleCollectPeople,
  handleDescribeActions,
  handleEndorseSkills,
  handleEnrichProfile,
  handleFollowPerson,
  handleLikePersonPosts,
  handleMessagePerson,
  handleRemoveConnection,
  handleSendInmail,
  handleSendInvite,
  handleFindApp,
  handleGetActionBudget,
  handleGetErrors,
  handleGetFeed,
  handleHideFeedAuthor,
  handleHideFeedAuthorProfile,
  handleGetPost,
  handleGetPostStats,
  handleGetProfileActivity,
  handleGetThrottleStatus,
  handleLaunchApp,
  handleListAccounts,
  handleListReferenceData,
  handleListWorkspaces,
  handleQueryMessages,
  handleQueryProfile,
  handleQueryProfiles,
  handleQueryProfilesBulk,
  handleRemovePeopleFromCollection,
  handleResolveEntity,
  handleScrapeMessagingHistory,
  handleSearchPosts,
  handleVisitProfile,
  handleQuitApp,
  handleReactToPost,
  handleReactToComment,
  handleStartInstance,
  handleStopInstance,
  handleUnfollowFromFeed,
  handleUnfollowProfile,
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

/** Parse a string as a max-results value: positive integer or -1 for unlimited. */
function parseMaxResults(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < -1 || n === 0) {
    throw new InvalidArgumentError(
      `Expected a positive integer or -1 for unlimited, got "${value}".`,
    );
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

/** Collect repeatable positive integer values into an array. */
function collectPositiveInt(value: string, previous: number[]): number[] {
  return [...previous, parsePositiveInt(value)];
}

/** Collect repeatable string values into an array. */
function collectString(value: string, previous: string[]): string[] {
  return [...previous, value];
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
    .action(handleLaunchApp);

  program
    .command("quit-app")
    .description("Quit the LinkedHelper application")
    .action(handleQuitApp);

  program
    .command("list-accounts")
    .description("List LinkedHelper accounts (selected workspace by default)")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .option("--all-workspaces", "List accounts across every workspace the LH user belongs to, not just the selected one (LinkedHelper 2.113.x+)")
    .action(handleListAccounts);

  program
    .command("list-workspaces")
    .description("List LinkedHelper workspaces the current user belongs to (2.113.x+)")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleListWorkspaces);

  program
    .command("start-instance")
    .description("Start a LinkedHelper instance")
    .argument("<accountId>", "Account ID to start", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .action(handleStartInstance);

  program
    .command("stop-instance")
    .description("Stop a LinkedHelper instance")
    .argument("<accountId>", "Account ID to stop", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .action(handleStopInstance);

  program
    .command("campaign-list")
    .description("List LinkedHelper campaigns")
    .option("--include-archived", "Include archived campaigns")
    .option("--json", "Output as JSON")
    .action(handleCampaignList);

  program
    .command("campaign-list-people")
    .description("List people assigned to a campaign")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .option("--action-id <id>", "Filter to a specific action", parsePositiveInt)
    .option("--status <status>", "Filter by status (queued, processed, successful, failed)")
    .option("--limit <n>", "Max results (default: 20)", parsePositiveInt)
    .option("--offset <n>", "Pagination offset (default: 0)", parseNonNegativeInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignListPeople);

  program
    .command("campaign-create")
    .description("Create a new campaign from YAML or JSON configuration")
    .option("--file <path>", "Path to campaign configuration file")
    .option("--yaml <config>", "Inline YAML campaign configuration")
    .option("--json-input <config>", "Inline JSON campaign configuration")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignCreate);

  program
    .command("campaign-get")
    .description("Get detailed campaign information")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignGet);

  program
    .command("campaign-delete")
    .description("Delete a campaign (archives by default, use --hard to permanently remove)")
    .argument("<campaignId>", "Campaign ID to delete", parsePositiveInt)
    .option("--hard", "Permanently delete the campaign and all related data")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignDelete);

  program
    .command("campaign-erase")
    .description("Permanently erase a campaign and all related data (irreversible)")
    .argument("<campaignId>", "Campaign ID to erase", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignErase);

  program
    .command("campaign-exclude-list")
    .description("View the exclude list for a campaign or action")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .option(
      "--action-id <id>",
      "Action ID (shows action-level exclude list instead of campaign-level)",
      parsePositiveInt,
    )
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignExcludeList);

  program
    .command("campaign-exclude-add")
    .description("Add people to a campaign or action exclude list")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .option("--person-ids <ids>", "Comma-separated person IDs")
    .option("--person-ids-file <path>", "File containing person IDs")
    .option(
      "--action-id <id>",
      "Action ID (adds to action-level exclude list instead of campaign-level)",
      parsePositiveInt,
    )
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignExcludeAdd);

  program
    .command("campaign-exclude-remove")
    .description("Remove people from a campaign or action exclude list")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .option("--person-ids <ids>", "Comma-separated person IDs")
    .option("--person-ids-file <path>", "File containing person IDs")
    .option(
      "--action-id <id>",
      "Action ID (removes from action-level exclude list instead of campaign-level)",
      parsePositiveInt,
    )
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignExcludeRemove);

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
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .action(handleCampaignExport);

  program
    .command("campaign-status")
    .description("Check campaign execution status")
    .argument("<campaignId>", "Campaign ID to check", parsePositiveInt)
    .option("--include-results", "Include execution results")
    .option("--limit <n>", "Max results to show (default: 20)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignStatus);

  program
    .command("campaign-statistics")
    .description("Get per-action statistics for a campaign")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .option("--action-id <id>", "Filter to a specific action", parsePositiveInt)
    .option("--max-errors <n>", "Max top errors per action (default: 5)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignStatistics);

  program
    .command("campaign-move-next")
    .description("Move people from one action to the next in a campaign")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .argument("<actionId>", "Action ID to move people from", parsePositiveInt)
    .option("--person-ids <ids>", "Comma-separated person IDs")
    .option("--person-ids-file <path>", "File containing person IDs")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignMoveNext);

  program
    .command("campaign-retry")
    .description("Reset specified people for re-run in a campaign")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .option("--person-ids <ids>", "Comma-separated person IDs")
    .option("--person-ids-file <path>", "File containing person IDs")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignRetry);

  program
    .command("campaign-start")
    .description("Start a campaign with specified target persons")
    .argument("<campaignId>", "Campaign ID to start", parsePositiveInt)
    .option("--person-ids <ids>", "Comma-separated person IDs")
    .option("--person-ids-file <path>", "File containing person IDs")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignStart);

  program
    .command("campaign-stop")
    .description("Stop a running campaign")
    .argument("<campaignId>", "Campaign ID to stop", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignStop);

  program
    .command("campaign-update")
    .description("Update a campaign's name and/or description")
    .argument("<campaignId>", "Campaign ID to update", parsePositiveInt)
    .option("--name <name>", "New campaign name")
    .option("--description <text>", "New campaign description")
    .option("--clear-description", "Clear the campaign description")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignUpdate);

  program
    .command("campaign-add-action")
    .description("Add a new action to a campaign's action chain")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .requiredOption("--name <name>", "Display name for the action")
    .requiredOption(
      "--action-type <type>",
      "Action type identifier (e.g., 'VisitAndExtract', 'MessageToPerson')",
    )
    .option("--description <text>", "Action description")
    .option(
      "--cool-down <ms>",
      "Milliseconds between action executions",
      parsePositiveInt,
    )
    .option(
      "--max-results <n>",
      "Maximum results per iteration (-1 for unlimited)",
      parseMaxResults,
    )
    .option("--action-settings <json>", "Action-specific settings as JSON")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignAddAction);

  program
    .command("campaign-remove-action")
    .description("Remove an action from a campaign's action chain")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .argument("<actionId>", "Action ID to remove", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignRemoveAction);

  program
    .command("campaign-update-action")
    .description("Update an existing action's configuration in a campaign")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .argument("<actionId>", "Action ID to update", parsePositiveInt)
    .option("--name <name>", "New display name for the action")
    .option("--description <text>", "New action description")
    .option("--clear-description", "Clear the action description")
    .option(
      "--cool-down <ms>",
      "Milliseconds between action executions",
      parsePositiveInt,
    )
    .option(
      "--max-results <n>",
      "Maximum results per iteration (-1 for unlimited)",
      parseMaxResults,
    )
    .option("--action-settings <json>", "Action-specific settings as JSON (merged with existing)")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignUpdateAction);

  program
    .command("campaign-reorder-actions")
    .description("Reorder actions in a campaign's action chain")
    .argument("<campaignId>", "Campaign ID", parsePositiveInt)
    .requiredOption(
      "--action-ids <ids>",
      "Comma-separated action IDs in desired order",
    )
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignReorderActions);

  program
    .command("import-people-from-urls")
    .description("Import LinkedIn profile URLs into a campaign action target list")
    .argument("<campaignId>", "Campaign ID to import into", parsePositiveInt)
    .option("--urls <urls>", "Comma-separated LinkedIn profile URLs")
    .option("--urls-file <path>", "File containing LinkedIn profile URLs")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleImportPeopleFromUrls);

  program
    .command("collect-people")
    .description("Collect people from a LinkedIn page into a campaign")
    .argument("<campaignId>", "Campaign ID to collect into", parsePositiveInt)
    .argument("<sourceUrl>", "LinkedIn page URL to collect from")
    .option("--limit <n>", "Max profiles to collect", parsePositiveInt)
    .option("--max-pages <n>", "Max pages to process", parsePositiveInt)
    .option("--page-size <n>", "Results per page", parsePositiveInt)
    .option("--source-type <type>", "Explicit source type (bypasses URL detection)")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCollectPeople);

  program
    .command("campaign-remove-people")
    .description("Remove people from a campaign's target list entirely")
    .argument("<campaignId>", "Campaign ID to remove people from", parsePositiveInt)
    .option("--person-ids <ids>", "Comma-separated person IDs")
    .option("--person-ids-file <path>", "File containing person IDs")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCampaignRemovePeople);

  program
    .command("list-collections")
    .description("List LinkedHelper collections (Lists)")
    .option("--json", "Output as JSON")
    .action(handleListCollections);

  program
    .command("create-collection")
    .description("Create a new LinkedHelper collection (List)")
    .argument("<name>", "Name for the new collection")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCreateCollection);

  program
    .command("delete-collection")
    .description("Delete a LinkedHelper collection (List) and its people associations")
    .argument("<collectionId>", "Collection ID to delete", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleDeleteCollection);

  program
    .command("add-people-to-collection")
    .description("Add people to a LinkedHelper collection (List)")
    .argument("<collectionId>", "Collection ID", parsePositiveInt)
    .option("--person-ids <ids>", "Comma-separated person IDs")
    .option("--person-ids-file <path>", "File containing person IDs")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleAddPeopleToCollection);

  program
    .command("remove-people-from-collection")
    .description("Remove people from a LinkedHelper collection (List)")
    .argument("<collectionId>", "Collection ID", parsePositiveInt)
    .option("--person-ids <ids>", "Comma-separated person IDs")
    .option("--person-ids-file <path>", "File containing person IDs")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleRemovePeopleFromCollection);

  program
    .command("import-people-from-collection")
    .description("Import people from a LinkedHelper collection (List) into a campaign")
    .argument("<collectionId>", "Collection ID to import from", parsePositiveInt)
    .argument("<campaignId>", "Campaign ID to import into", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleImportPeopleFromCollection);

  program
    .command("describe-actions")
    .description("List available LinkedHelper action types")
    .option("--category <category>", "Filter by category (people, messaging, engagement, crm, workflow)")
    .option("--type <type>", "Get details for a specific action type")
    .option("--json", "Output as JSON")
    .action(handleDescribeActions);

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
    .option("--include-positions", "Include full position history (career history)")
    .option("--json", "Output as JSON")
    .action(handleQueryProfile);

  program
    .command("query-profiles")
    .description("Search for profiles in the local database")
    .option("--query <text>", "Search name or headline")
    .option("--company <name>", "Filter by company")
    .option("--include-history", "Search past positions too (not just current)")
    .option("--limit <n>", "Max results (default: 20)", parsePositiveInt)
    .option("--offset <n>", "Pagination offset (default: 0)", parseNonNegativeInt)
    .option("--json", "Output as JSON")
    .action(handleQueryProfiles);

  program
    .command("query-profiles-bulk")
    .description("Look up multiple cached profiles from the local database in a single call")
    .option("--person-id <id>", "Look up by internal person ID (repeatable)", collectPositiveInt, [])
    .option("--public-id <slug>", "Look up by LinkedIn public ID (repeatable)", collectString, [])
    .option("--include-positions", "Include full position history (career history)")
    .option("--json", "Output as JSON")
    .action(handleQueryProfilesBulk);

  program
    .command("scrape-messaging-history")
    .description(
      "Scrape messaging history from LinkedIn into the local database",
    )
    .option("--person-id <id>", "Person ID to scrape (repeatable, at least one required)", collectPositiveInt, [])
    .option("--pause-others", "Pause all other campaigns during execution, then restore them")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleScrapeMessagingHistory);

  program
    .command("visit-profile")
    .description(
      "Visit a LinkedIn profile and extract data (name, positions, education, skills)",
    )
    .option("--person-id <id>", "Person ID to visit (provide this or --url)", parsePositiveInt)
    .option("--url <url>", "LinkedIn profile URL to visit (provide this or --person-id)")
    .option("--extract-current-organizations", "Extract current company info during profile visit")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleVisitProfile);

  program
    .command("check-replies")
    .description("Check for new message replies from LinkedIn")
    .option("--person-id <id>", "Person ID to check (repeatable, at least one required)", collectPositiveInt, [])
    .option("--since <timestamp>", "Only show replies after this ISO timestamp")
    .option("--pause-others", "Pause all other campaigns during execution, then restore them")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCheckReplies);

  program
    .command("check-status")
    .description("Check LinkedHelper status")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleCheckStatus);

  program
    .command("get-errors")
    .description("Query current UI errors, dialogs, and blocking popups")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleGetErrors);

  program
    .command("dismiss-errors")
    .description("Dismiss closable error popups in the instance UI")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleDismissErrors);

  program
    .command("get-action-budget")
    .description("Get daily action budget with limit types, thresholds, and usage")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleGetActionBudget);

  program
    .command("get-throttle-status")
    .description("Check if LinkedIn is throttling the account")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleGetThrottleStatus);

  program
    .command("comment-on-post")
    .description("Post a comment on a LinkedIn post")
    .requiredOption("--url <url>", "LinkedIn post URL")
    .requiredOption("--text <text>", "Comment text to post")
    .option("--parent-comment-urn <urn>", "Reply to a specific comment instead of posting top-level (use commentUrn from get-post)")
    .option("--mentions <json>", 'JSON array of {name} objects for @mentions (e.g. \'[{"name":"John Doe"}]\')')
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--dry-run", "Validate the comment flow but skip typing and submitting")
    .option("--json", "Output as JSON")
    .action(handleCommentOnPost);

  program
    .command("get-post")
    .description("Get detailed data for a single LinkedIn post with comment thread")
    .argument("<postUrl>", "LinkedIn post URL or URN")
    .option("--comment-count <n>", "Maximum number of comments to load (default: 100, 0 to skip)", parseNonNegativeInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleGetPost);

  program
    .command("get-post-stats")
    .description("Get engagement statistics for a LinkedIn post")
    .argument("<postUrl>", "LinkedIn post URL or URN")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleGetPostStats);

  program
    .command("get-feed")
    .description("Read the LinkedIn home feed with cursor-based pagination")
    .option("--count <n>", "Number of posts per page (default: 10)", parsePositiveInt)
    .option("--cursor <token>", "Cursor token from a previous call for the next page")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleGetFeed);

  program
    .command("dismiss-feed-post")
    .description('Dismiss a post from the LinkedIn feed by clicking "Not interested"')
    .argument("<feedIndex>", "Zero-based index of the post in the visible feed", parseNonNegativeInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--dry-run", "Locate the menu item without clicking it")
    .option("--json", "Output as JSON")
    .action(handleDismissFeedPost);

  program
    .command("react-to-post")
    .description("React to a LinkedIn post with a specific reaction type")
    .argument("<postUrl>", "LinkedIn post URL")
    .addOption(
      new Option("--type <type>", "Reaction type (default: like)")
        .choices(["like", "celebrate", "support", "love", "insightful", "funny"])
        .default("like"),
    )
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--dry-run", "Detect current reaction state without clicking")
    .option("--json", "Output as JSON")
    .action(handleReactToPost);

  program
    .command("react-to-comment")
    .description("React to a specific LinkedIn comment with a specific reaction type")
    .argument("<postUrl>", "LinkedIn post URL containing the target comment")
    .argument("<commentUrn>", "Comment URN (urn:li:comment:(activity:...,...))")
    .addOption(
      new Option("--type <type>", "Reaction type (default: like)")
        .choices(["like", "celebrate", "support", "love", "insightful", "funny"])
        .default("like"),
    )
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--dry-run", "Detect current reaction state without clicking")
    .option("--json", "Output as JSON")
    .action(handleReactToComment);

  program
    .command("unfollow-from-feed")
    .description("Unfollow the author of a post via its feed three-dot menu")
    .argument("<feedIndex>", "Zero-based index of the post in the visible feed", parseNonNegativeInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--dry-run", "Locate the menu item without clicking it")
    .option("--json", "Output as JSON")
    .action(handleUnfollowFromFeed);

  program
    .command("hide-feed-author")
    .description("Click 'Hide posts by {Name}' in a feed post's three-dot menu")
    .argument("<feedIndex>", "Zero-based index of the post in the visible feed", parseNonNegativeInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--dry-run", "Locate the menu item without clicking it")
    .option("--json", "Output as JSON")
    .action(handleHideFeedAuthor);

  program
    .command("hide-feed-author-profile")
    .description("Mute a LinkedIn profile's posts via the profile page's More menu (primarily 1st-degree connections)")
    .argument("<profileUrl>", "LinkedIn profile URL")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--dry-run", "Open the More menu and detect mute availability without clicking Mute")
    .option("--json", "Output as JSON")
    .action(handleHideFeedAuthorProfile);

  program
    .command("unfollow-profile")
    .description("Unfollow a LinkedIn member profile or organization page by navigating to it and clicking Following → Unfollow")
    .argument("<profileUrl>", "LinkedIn profile URL (/in/{publicId}/) or company URL (/company/{slug}/)")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--dry-run", "Detect the follow state without clicking Unfollow")
    .option("--json", "Output as JSON")
    .action(handleUnfollowProfile);

  program
    .command("get-profile-activity")
    .description("Get recent posts/activity from a LinkedIn profile")
    .argument("<profile>", "LinkedIn profile public ID or URL")
    .option("--count <n>", "Number of posts per page (default: 10)", parsePositiveInt)
    .option("--cursor <token>", "Cursor token from a previous call for the next page")
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleGetProfileActivity);

  program
    .command("build-url")
    .description("Build a LinkedIn URL for a given source type")
    .argument("<sourceType>", "Source type (e.g., SearchPage, SNSearchPage, OrganizationPeople)")
    .option("--keywords <keywords>", "Search keywords (SearchPage, SNSearchPage)")
    .option("--current-company <id>", "Current company ID (SearchPage, repeatable)", collectString, [])
    .option("--past-company <id>", "Past company ID (SearchPage, repeatable)", collectString, [])
    .option("--geo <id>", "Geographic URN ID (SearchPage, repeatable)", collectString, [])
    .option("--industry <id>", "Industry ID (SearchPage, repeatable)", collectString, [])
    .option("--school <id>", "School ID (SearchPage, repeatable)", collectString, [])
    .option("--network <code>", "Connection degree: F, S, O (SearchPage, repeatable)", collectString, [])
    .option("--profile-language <code>", "Profile language code (SearchPage, repeatable)", collectString, [])
    .option("--service-category <id>", "Service category ID (SearchPage, repeatable)", collectString, [])
    .option("--filter <spec>", "SN filter TYPE|ID|TEXT|INCLUDED (SNSearchPage, repeatable)", collectString, [])
    .option("--slug <slug>", "Company or school slug (OrganizationPeople, Alumni)")
    .option("--id <id>", "Entity ID (Group, Event, SNListPage, etc.)")
    .option("--json", "Output as JSON")
    .action(handleBuildUrl);

  program
    .command("resolve-entity")
    .description("Resolve a LinkedIn entity (company, geo, school) by name via the public LinkedIn typeahead (no auth, no LinkedHelper required)")
    .argument("<entityType>", "Entity type: COMPANY, GEO, or SCHOOL")
    .argument("<query>", "Search query")
    .option("--limit <n>", "Max results to show", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleResolveEntity);

  program
    .command("list-reference-data")
    .description("List LinkedIn reference data (industries, seniorities, functions, etc.)")
    .argument("<dataType>", "Data type: INDUSTRY, SENIORITY, FUNCTION, COMPANY_SIZE, CONNECTION_DEGREE, PROFILE_LANGUAGE")
    .option("--json", "Output as JSON")
    .action(handleListReferenceData);

  program
    .command("search-posts")
    .description("Search LinkedIn for posts by keyword or hashtag")
    .argument("<query>", "Search query (keywords or hashtag)")
    .option("--cursor <n>", "Index-based cursor from a previous search for the next page", parseNonNegativeInt)
    .option("--count <n>", "Results per page (default: 10)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleSearchPosts);

  // Individual actions (ephemeral campaign)
  program
    .command("message-person")
    .description("Send a direct message to a 1st-degree LinkedIn connection")
    .option("--person-id <id>", "Person ID (provide this or --url)", parsePositiveInt)
    .option("--url <url>", "LinkedIn profile URL (provide this or --person-id)")
    .requiredOption("--message-template <json>", "Message template as JSON")
    .option("--subject-template <json>", "Subject line template as JSON")
    .option("--reject-if-replied", "Skip if person already replied")
    .option("--reject-if-messaged", "Skip if already messaged")
    .option("--keep-campaign", "Archive the ephemeral campaign instead of deleting it")
    .option("--timeout <ms>", "Maximum time to wait for action completion in milliseconds (default: 5 min)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleMessagePerson);

  program
    .command("send-invite")
    .description("Send a LinkedIn connection request")
    .option("--person-id <id>", "Person ID (provide this or --url)", parsePositiveInt)
    .option("--url <url>", "LinkedIn profile URL (provide this or --person-id)")
    .option("--message-template <json>", "Invitation message template as JSON (empty for no message)")
    .option("--save-as-lead-sn", "Save as lead in Sales Navigator")
    .option("--keep-campaign", "Archive the ephemeral campaign instead of deleting it")
    .option("--timeout <ms>", "Maximum time to wait for action completion in milliseconds (default: 5 min)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleSendInvite);

  program
    .command("send-inmail")
    .description("Send an InMail message to a LinkedIn member (no connection required)")
    .option("--person-id <id>", "Person ID (provide this or --url)", parsePositiveInt)
    .option("--url <url>", "LinkedIn profile URL (provide this or --person-id)")
    .requiredOption("--message-template <json>", "InMail body template as JSON")
    .option("--subject-template <json>", "InMail subject line template as JSON")
    .option("--reject-if-replied", "Skip if person already replied")
    .option("--proceed-on-out-of-credits", "Continue even when InMail credits are exhausted")
    .option("--keep-campaign", "Archive the ephemeral campaign instead of deleting it")
    .option("--timeout <ms>", "Maximum time to wait for action completion in milliseconds (default: 5 min)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleSendInmail);

  program
    .command("follow-person")
    .description("Follow or unfollow a LinkedIn profile")
    .option("--person-id <id>", "Person ID (provide this or --url)", parsePositiveInt)
    .option("--url <url>", "LinkedIn profile URL (provide this or --person-id)")
    .addOption(
      new Option("--mode <mode>", "Follow or unfollow")
        .choices(["follow", "unfollow"])
        .default("follow"),
    )
    .option("--skip-if-unfollowable", "Skip if person cannot be unfollowed")
    .option("--keep-campaign", "Archive the ephemeral campaign instead of deleting it")
    .option("--timeout <ms>", "Maximum time to wait for action completion in milliseconds (default: 5 min)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleFollowPerson);

  program
    .command("endorse-skills")
    .description("Endorse skills on a LinkedIn profile")
    .option("--person-id <id>", "Person ID (provide this or --url)", parsePositiveInt)
    .option("--url <url>", "LinkedIn profile URL (provide this or --person-id)")
    .option("--skill-name <name>", "Specific skill name to endorse (repeatable)", collectString, [])
    .option("--limit <n>", "Max number of skills to endorse", parsePositiveInt)
    .option("--skip-if-not-endorsable", "Skip if person has no endorsable skills")
    .option("--keep-campaign", "Archive the ephemeral campaign instead of deleting it")
    .option("--timeout <ms>", "Maximum time to wait for action completion in milliseconds (default: 5 min)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const skillNames = (opts.skillName as string[] | undefined)?.length
        ? opts.skillName as string[]
        : undefined;
      return handleEndorseSkills({ ...opts, skillNames, skillName: undefined });
    });

  program
    .command("like-person-posts")
    .description("Like and optionally comment on posts and articles by a LinkedIn profile")
    .option("--person-id <id>", "Person ID (provide this or --url)", parsePositiveInt)
    .option("--url <url>", "LinkedIn profile URL (provide this or --person-id)")
    .option("--number-of-articles <n>", "Number of articles to like", parsePositiveInt)
    .option("--number-of-posts <n>", "Number of posts to like", parsePositiveInt)
    .option("--max-age-of-articles <days>", "Maximum age of articles in days", parsePositiveInt)
    .option("--max-age-of-posts <days>", "Maximum age of posts in days", parsePositiveInt)
    .option("--should-add-comment", "Also add a comment to liked posts/articles")
    .option("--message-template <json>", "Comment text template as JSON (required with --should-add-comment)")
    .option("--skip-if-not-liked", "Skip if nothing was liked")
    .option("--keep-campaign", "Archive the ephemeral campaign instead of deleting it")
    .option("--timeout <ms>", "Maximum time to wait for action completion in milliseconds (default: 5 min)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleLikePersonPosts);

  program
    .command("remove-connection")
    .description("Remove a person from 1st-degree LinkedIn connections (unfriend)")
    .option("--person-id <id>", "Person ID (provide this or --url)", parsePositiveInt)
    .option("--url <url>", "LinkedIn profile URL (provide this or --person-id)")
    .option("--keep-campaign", "Archive the ephemeral campaign instead of deleting it")
    .option("--timeout <ms>", "Maximum time to wait for action completion in milliseconds (default: 5 min)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleRemoveConnection);

  program
    .command("enrich-profile")
    .description("Enrich a LinkedIn profile by extracting additional data")
    .option("--person-id <id>", "Person ID (provide this or --url)", parsePositiveInt)
    .option("--url <url>", "LinkedIn profile URL (provide this or --person-id)")
    .option("--enrich-profile-info", "Enrich profile info")
    .option("--enrich-phones", "Enrich phone numbers")
    .option("--enrich-emails", "Enrich email addresses")
    .option("--enrich-socials", "Enrich social profiles")
    .option("--enrich-companies", "Enrich company data")
    .option("--keep-campaign", "Archive the ephemeral campaign instead of deleting it")
    .option("--timeout <ms>", "Maximum time to wait for action completion in milliseconds (default: 5 min)", parsePositiveInt)
    .option("--cdp-port <port>", "CDP debugging port (auto-discovered when omitted)", parsePositiveInt)
    .option("--cdp-host <host>", "CDP host (default: 127.0.0.1)")
    .option("--allow-remote", "SECURITY: allow non-loopback CDP connections (enables remote code execution on target)")
    .option("--json", "Output as JSON")
    .action(handleEnrichProfile);

  return program;
}
