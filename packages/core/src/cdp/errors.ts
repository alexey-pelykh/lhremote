// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

/**
 * Base class for all CDP-related errors.
 */
export class CDPError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CDPError";
  }
}

/**
 * Thrown when a WebSocket connection to a CDP target cannot be established
 * or is unexpectedly lost.
 */
export class CDPConnectionError extends CDPError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CDPConnectionError";
  }
}

/**
 * Thrown when a CDP request does not receive a response within the
 * configured timeout.
 */
export class CDPTimeoutError extends CDPError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CDPTimeoutError";
  }
}

/**
 * Thrown when `Runtime.evaluate` (or similar) returns a CDP-level error
 * or an exception from the evaluated expression.
 */
export class CDPEvaluationError extends CDPError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CDPEvaluationError";
  }
}
