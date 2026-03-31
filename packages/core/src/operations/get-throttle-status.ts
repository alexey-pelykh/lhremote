// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ThrottleStatus } from "../types/index.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { buildCdpOptions, type ConnectionOptions } from "./types.js";

export type GetThrottleStatusInput = ConnectionOptions;

export type GetThrottleStatusOutput = ThrottleStatus;

export async function getThrottleStatus(
  input: GetThrottleStatusInput,
): Promise<GetThrottleStatusOutput> {
  const cdpPort = input.cdpPort;

  const accountId = await resolveAccount(cdpPort, buildCdpOptions(input));

  return withInstanceDatabase(cdpPort, accountId, async ({ instance }) => {
    return instance.evaluateUI<ThrottleStatus>(
      `(() => {
        const mws = window.mainWindowService;
        if (!mws) return { throttled: false, since: null };
        const td = mws.throttleDetector;
        if (!td) return { throttled: false, since: null };
        const throttled = !!td.isThrottling();
        const lastDate = td.getLastThrottleDate();
        const since = lastDate ? new Date(lastDate).toISOString() : null;
        return { throttled, since };
      })()`,
    );
  }, {
    launcher: buildCdpOptions(input),
  });
}
