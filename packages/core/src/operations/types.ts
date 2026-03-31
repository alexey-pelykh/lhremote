// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { SessionPacer } from "../utils/session-pacer.js";

/**
 * Connection options shared by all operations that need to reach a
 * running LinkedHelper instance via CDP.
 *
 * When {@link cdpPort} is omitted, the appropriate port is
 * auto-discovered from running LinkedHelper processes.
 *
 * When {@link pacer} is provided, operations call
 * {@link SessionPacer.paceBeforeOperation} before starting to enforce
 * inter-operation cool-down gaps that model natural session rhythm.
 */
export interface ConnectionOptions {
  readonly cdpPort?: number | undefined;
  readonly cdpHost?: string | undefined;
  readonly allowRemote?: boolean | undefined;
  readonly pacer?: SessionPacer | undefined;
}

/**
 * Build the CDP connection options object from a {@link ConnectionOptions}
 * source (typically the operation input).
 *
 * Maps `cdpHost` → `host` and passes through `allowRemote`, omitting
 * fields that are `undefined`.
 */
export function buildCdpOptions(input: {
  cdpHost?: string | undefined;
  allowRemote?: boolean | undefined;
}): { host?: string; allowRemote?: boolean } {
  return {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  };
}
