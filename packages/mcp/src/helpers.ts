// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import {
  AccountResolutionError,
  errorMessage,
  LinkedHelperNotRunningError,
} from "@lhremote/core";

type TextContent = { type: "text"; text: string };
type McpResult = { isError?: boolean; content: TextContent[] };

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
 * resolution failures) to an MCP error response.
 *
 * Returns `undefined` if the error is not a recognised infrastructure
 * error so the caller can fall through to domain-specific handling.
 */
export function mapErrorToMcpResponse(error: unknown): McpResult | undefined {
  if (error instanceof LinkedHelperNotRunningError) {
    return mcpError("LinkedHelper is not running. Use launch-app first.");
  }
  if (error instanceof AccountResolutionError) {
    return mcpError(error.message);
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
