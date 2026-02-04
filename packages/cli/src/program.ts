import { createRequire } from "node:module";

import { Command, InvalidArgumentError } from "commander";

import {
  handleCheckStatus,
  handleFindApp,
  handleLaunchApp,
  handleListAccounts,
  handleQueryProfile,
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
    .command("query-profile")
    .description("Look up a cached profile from the local database")
    .option("--person-id <id>", "Look up by internal person ID", parsePositiveInt)
    .option("--public-id <slug>", "Look up by LinkedIn public ID")
    .option("--json", "Output as JSON")
    .action(handleQueryProfile);

  program
    .command("check-status")
    .description("Check LinkedHelper status")
    .option("--cdp-port <port>", "CDP debugging port", parsePositiveInt)
    .option("--json", "Output as JSON")
    .action(handleCheckStatus);

  return program;
}
