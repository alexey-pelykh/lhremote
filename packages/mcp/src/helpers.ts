// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  AccountResolutionError,
  CampaignNotFoundError,
  DEFAULT_CDP_PORT,
  errorMessage,
  LinkedHelperNotRunningError,
} from "@lhremote/core";
import { z } from "zod";

type TextContent = { type: "text"; text: string };
type McpResult = { isError?: boolean; content: TextContent[] };

/**
 * Shared Zod schema fields for CDP connection parameters.
 *
 * Spread into every tool that connects to a LinkedHelper instance:
 * ```ts
 * { campaignId: z.number(), ...cdpConnectionSchema }
 * ```
 */
export const cdpConnectionSchema = {
  cdpPort: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_CDP_PORT)
    .describe("CDP port"),
  cdpHost: z
    .string()
    .optional()
    .describe("CDP host (default: 127.0.0.1)"),
  allowRemote: z
    .boolean()
    .optional()
    .describe("SECURITY: Allow non-loopback CDP connections. Enables remote code execution on target host. Only use if network path is secured."),
};

/**
 * Build the CDP connection options object from parsed tool arguments.
 *
 * Replaces the inline conditional-spread pattern used by tools that
 * call `resolveAccount` or construct a `LauncherService`.
 */
export function buildCdpOptions(args: {
  cdpHost?: string | undefined;
  allowRemote?: boolean | undefined;
}): { host?: string; allowRemote?: boolean } {
  return {
    ...(args.cdpHost !== undefined && { host: args.cdpHost }),
    ...(args.allowRemote !== undefined && { allowRemote: args.allowRemote }),
  };
}

/**
 * Build an MCP error response from a plain message string.
 */
export function mcpError(text: string): McpResult {
  return {
    isError: true,
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Build an MCP success response from a plain text or JSON payload.
 */
export function mcpSuccess(text: string): McpResult {
  return {
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Map common infrastructure errors (launcher not running, account
 * resolution failures) and domain errors (campaign not found) to an
 * MCP error response.
 *
 * Returns `undefined` if the error is not a recognised error so the
 * caller can fall through to domain-specific handling.
 */
export function mapErrorToMcpResponse(error: unknown): McpResult | undefined {
  if (error instanceof LinkedHelperNotRunningError) {
    return mcpError("LinkedHelper is not running. Use launch-app first.");
  }
  if (error instanceof AccountResolutionError) {
    return mcpError(error.message);
  }
  if (error instanceof CampaignNotFoundError) {
    return mcpError(
      `Campaign ${String(error.campaignId)} not found.`,
    );
  }
  return undefined;
}

/**
 * Map an arbitrary caught error to an MCP error response with a
 * contextual prefix (e.g. "Failed to create campaign").
 */
export function mcpCatchAll(error: unknown, prefix: string): McpResult {
  const mapped = mapErrorToMcpResponse(error);
  if (mapped) return mapped;

  const message = errorMessage(error);
  return mcpError(`${prefix}: ${message}`);
}
