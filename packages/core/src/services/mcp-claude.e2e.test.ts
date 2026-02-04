import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Account } from "../types/index.js";
import { describeE2E, launchApp, quitApp } from "../testing/e2e-helpers.js";
import { LauncherService } from "./launcher.js";
import { AppService } from "./app.js";

/**
 * Whether the `claude` CLI is available on the system PATH.
 */
const claudeAvailable = (() => {
  try {
    execFileSync("claude", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

/** Absolute path to the compiled MCP server entry point. */
const mcpServerPath = resolve(
  import.meta.dirname,
  "../../../mcp/dist/index.js",
);

interface ClaudeJsonResult {
  type: string;
  subtype: string;
  is_error: boolean;
  result: string;
  num_turns: number;
  session_id: string;
  total_cost_usd: number;
}

/**
 * Run a prompt through `claude -p` with the lhremote MCP server attached.
 *
 * Uses `--strict-mcp-config` so only lhremote tools are available,
 * `--model haiku` for cost efficiency, and `--output-format json`
 * for deterministic parsing.
 */
function runClaude(prompt: string, timeoutMs = 60_000): ClaudeJsonResult {
  const mcpConfig = JSON.stringify({
    mcpServers: {
      lhremote: {
        command: "node",
        args: [mcpServerPath],
      },
    },
  });

  const output = execFileSync("claude", [
    "-p",
    prompt,
    "--mcp-config", mcpConfig,
    "--strict-mcp-config",
    "--model", "haiku",
    "--output-format", "json",
    "--allowedTools", "mcp__lhremote__*",
    "--no-session-persistence",
  ], {
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
  });

  return JSON.parse(output) as ClaudeJsonResult;
}

describeE2E("MCP tools via Claude CLI", () => {
  // Second gate: skip everything if `claude` CLI is not installed
  const skipClaude = !claudeAvailable;

  // Shared state across all tests
  let app: AppService;
  let port: number;
  let accountId: number | undefined;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    const launcher = new LauncherService(port);
    await launcher.connect();
    const accounts = await launcher.listAccounts();
    launcher.disconnect();

    if (accounts.length > 0) {
      accountId = (accounts[0] as Account).id;
    }
  }, 60_000);

  afterAll(async () => {
    await quitApp(app);
  }, 30_000);

  describe.skipIf(skipClaude)("claude -p integration", () => {
    it(
      "list-accounts returns configured accounts",
      () => {
        const result = runClaude(
          "Use the list-accounts tool to list LinkedHelper accounts. " +
          "Report the raw JSON array from the tool response, nothing else.",
        );

        expect(result.is_error).toBe(false);
        expect(result.num_turns).toBeGreaterThanOrEqual(2);
        // The response should mention account data
        expect(result.result).toBeTruthy();
      },
      120_000,
    );

    it(
      "check-status returns a status report",
      () => {
        const result = runClaude(
          "Use the check-status tool to check LinkedHelper status. " +
          "Report the raw JSON from the tool response, nothing else.",
        );

        expect(result.is_error).toBe(false);
        expect(result.num_turns).toBeGreaterThanOrEqual(2);
        // The response should contain status information
        expect(result.result).toMatch(/launcher|reachable|instances|database/i);
      },
      120_000,
    );

    it(
      "visit-and-extract extracts profile data",
      () => {
        expect(accountId, "No accounts configured in LinkedHelper").toBeDefined();

        // First ensure an instance is running via start-instance
        const startResult = runClaude(
          `Use the start-instance tool to start an instance for account ${String(accountId)}. ` +
          "Report what the tool returns.",
          120_000,
        );
        expect(startResult.is_error).toBe(false);

        // Now visit and extract a profile
        const result = runClaude(
          "Use the visit-and-extract tool to extract the LinkedIn profile at " +
          "https://www.linkedin.com/in/williamhgates — " +
          "report the raw JSON from the tool response, nothing else.",
          180_000,
        );

        expect(result.is_error).toBe(false);
        expect(result.num_turns).toBeGreaterThanOrEqual(2);
        // The response should contain profile fields
        expect(result.result).toMatch(/firstName|positions|skills/i);
      },
      300_000,
    );

    it(
      "query-profile returns cached profile data",
      () => {
        // Profile should already be cached from visit-and-extract test above
        const result = runClaude(
          "Use the query-profile tool with publicId 'williamhgates' to look up a cached profile. " +
          "Report the raw JSON from the tool response, nothing else.",
        );

        expect(result.is_error).toBe(false);
        expect(result.num_turns).toBeGreaterThanOrEqual(2);
        // The response should contain profile fields
        expect(result.result).toMatch(/firstName|positions|skills/i);
      },
      120_000,
    );
  });
});
