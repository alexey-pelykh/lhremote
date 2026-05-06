// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { resolveInstancePort } from "../cdp/index.js";
import { ServiceError } from "../services/errors.js";
import { InstanceService } from "../services/instance.js";
import { waitForLoggedInState } from "./wait-for-logged-in-state.js";

/**
 * Default deadline for the post-failure `waitForLoggedInState` (60s).
 * Mirrors {@link waitForLoggedInState}'s default — the retry path waits
 * the same amount as a fresh gate before declaring the CW genuinely stuck.
 */
const DEFAULT_WAIT_TIMEOUT = 60_000;

/** Default retry budget (one extra attempt after the wait). */
const DEFAULT_MAX_RETRIES = 1;

/**
 * Thrown when the LinkedHelper instance keeps surfacing
 * `Action.IncorrectContentStateError` (or its `IncorrectStateType`/
 * `StateIsNotFinal` siblings) after the configured retry budget — i.e.
 * the LinkedIn ContentWindow is genuinely stuck in a non-`LoggedInState`
 * variant (security checkpoint, persistent re-authentication, etc.).
 *
 * Wraps the original error as {@link innerError} so callers can inspect
 * the underlying failure mode.
 */
export class LoggedInStatePersistedError extends ServiceError {
  readonly waitedMs: number;
  readonly innerError: Error;

  constructor(waitedMs: number, innerError: Error) {
    super(
      `LinkedIn ContentWindow stuck in non-LoggedInState after ${String(waitedMs)}ms — ` +
        `${innerError.message}`,
    );
    this.name = "LoggedInStatePersistedError";
    this.waitedMs = waitedMs;
    this.innerError = innerError;
  }
}

export interface WithLoggedInStateRetryOptions {
  /** Maximum number of retries after the initial failure (default `1`). */
  readonly maxRetries?: number;
  /** Deadline for the post-failure `waitForLoggedInState` in ms (default `60_000`). */
  readonly waitTimeout?: number;
}

/**
 * Heuristic: does this error look like LinkedHelper's
 * `Action.IncorrectContentStateError` (or one of its framework-level
 * siblings, `IncorrectStateType` / `StateIsNotFinal`)?
 *
 * The error surfaces through CDP `Runtime.evaluate` as a plain `Error`
 * whose `.message` carries either the literal class name or the
 * canonical predicate-failure phrasing
 * (`state \`<X>\` is not \`<Y>\``).  See research §5.1 / §5.2 for the
 * underlying class hierarchy.
 *
 * Conservative match: we accept any of the LH-specific class names AND
 * the predicate phrasing.  A false negative just skips the retry; a
 * false positive surfaces as `LoggedInStatePersistedError` after one
 * unnecessary wait — both are acceptable failure modes.
 */
function isIncorrectContentStateError(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const name = err instanceof Error ? err.name : "";

  if (!message && !name) return false;
  return (
    /Action\.IncorrectContentStateError/i.test(message) ||
    /IncorrectContentStateError/.test(name) ||
    /IncorrectStateType/.test(message) ||
    /IncorrectStateType/.test(name) ||
    /StateIsNotFinal/.test(message) ||
    /StateIsNotFinal/.test(name) ||
    // Canonical predicate-failure phrasing emitted by the framework.
    /state\s+`[^`]+`\s+is\s+not\s+`[^`]+`/.test(message) ||
    /Incorrect\s+web-page\s+state/i.test(message)
  );
}

/**
 * Run an operation with one transparent retry when the underlying
 * LinkedHelper action fails with `Action.IncorrectContentStateError`.
 *
 * Flow:
 * 1. Run `op()`.  Return on success.
 * 2. On failure, classify: not an `IncorrectContentStateError` → rethrow.
 * 3. Out of retry budget → wrap as {@link LoggedInStatePersistedError} and rethrow.
 * 4. Wait for `LoggedInState` (up to {@link WithLoggedInStateRetryOptions.waitTimeout}).
 *    If the wait itself times out, the resulting `LoggedInStateTimeoutError`
 *    propagates — the caller sees the gate failure, not the retry failure.
 * 5. Loop.
 *
 * Mirrors LH's own `CampaignController.ensureCwIsInLoggedInState`
 * pattern (research §10) at a coarser granularity: we don't have the
 * launcher's renavigation budget, so the wrapper relies on LinkedIn
 * settling within `waitTimeout` rather than forcing a fresh navigation.
 *
 * @throws {LoggedInStatePersistedError} when retries are exhausted and
 *   the same `IncorrectContentStateError` is still surfacing.
 */
export async function withLoggedInStateRetry<T>(
  instance: InstanceService,
  op: () => Promise<T>,
  opts: WithLoggedInStateRetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const waitTimeout = opts.waitTimeout ?? DEFAULT_WAIT_TIMEOUT;

  let attempt = 0;
  let totalWaitedMs = 0;
  while (true) {
    try {
      return await op();
    } catch (err) {
      if (!isIncorrectContentStateError(err)) {
        throw err;
      }
      if (attempt >= maxRetries) {
        const inner = err instanceof Error ? err : new Error(String(err));
        throw new LoggedInStatePersistedError(totalWaitedMs, inner);
      }
      attempt++;
      const waitStart = Date.now();
      try {
        await waitForLoggedInState(instance, { timeout: waitTimeout });
      } finally {
        totalWaitedMs += Date.now() - waitStart;
      }
    }
  }
}

/**
 * Convenience wrapper for CLI/MCP handlers that don't already have an
 * {@link InstanceService} in scope.  Behaves identically to
 * {@link withLoggedInStateRetry} but lazily constructs an
 * `InstanceService` on the failure path only — the happy path issues
 * zero extra CDP connections.
 */
export async function withLoggedInStateRetryAtPort<T>(
  cdpPort: number | undefined,
  cdpHost: string,
  allowRemote: boolean,
  op: () => Promise<T>,
  opts: WithLoggedInStateRetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const waitTimeout = opts.waitTimeout ?? DEFAULT_WAIT_TIMEOUT;

  let attempt = 0;
  let totalWaitedMs = 0;
  while (true) {
    try {
      return await op();
    } catch (err) {
      if (!isIncorrectContentStateError(err)) {
        throw err;
      }
      if (attempt >= maxRetries) {
        const inner = err instanceof Error ? err : new Error(String(err));
        throw new LoggedInStatePersistedError(totalWaitedMs, inner);
      }
      attempt++;
      const waitStart = Date.now();
      try {
        const resolvedPort = await resolveInstancePort(cdpPort, cdpHost);
        const instance = new InstanceService(resolvedPort, { host: cdpHost, allowRemote });
        await instance.connect();
        try {
          await waitForLoggedInState(instance, { timeout: waitTimeout });
        } finally {
          instance.disconnect();
        }
      } finally {
        totalWaitedMs += Date.now() - waitStart;
      }
    }
  }
}
