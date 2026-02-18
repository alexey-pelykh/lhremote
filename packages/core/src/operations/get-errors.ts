// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { UIHealthStatus } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { LauncherService } from "../services/launcher.js";
import { DEFAULT_CDP_PORT } from "../constants.js";
import type { ConnectionOptions } from "./types.js";

/**
 * Input for the get-errors operation.
 */
export type GetErrorsInput = ConnectionOptions;

/**
 * Output from the get-errors operation.
 */
export interface GetErrorsOutput extends UIHealthStatus {
  readonly accountId: number;
}

/**
 * Query the current error/dialog/popup state of a LinkedHelper instance.
 *
 * Connects to the launcher, resolves the account, and returns the
 * aggregated UI health status including active instance issues and
 * popup overlay state.
 */
export async function getErrors(
  input: GetErrorsInput,
): Promise<GetErrorsOutput> {
  const cdpPort = input.cdpPort ?? DEFAULT_CDP_PORT;

  const cdpOptions = {
    ...(input.cdpHost !== undefined && { host: input.cdpHost }),
    ...(input.allowRemote !== undefined && { allowRemote: input.allowRemote }),
  };

  const accountId = await resolveAccount(cdpPort, cdpOptions);

  const launcher = new LauncherService(cdpPort, cdpOptions);
  try {
    await launcher.connect();
    const health = await launcher.checkUIHealth(accountId);
    return { accountId, ...health };
  } finally {
    launcher.disconnect();
  }
}
