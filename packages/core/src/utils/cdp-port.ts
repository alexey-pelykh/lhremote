// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/** Timeout for CDP port probe requests (ms). */
const PROBE_TIMEOUT = 3_000;

/**
 * Check whether a port exposes a CDP `/json/list` endpoint.
 */
export async function isCdpPort(port: number): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/json/list`,
      { signal: AbortSignal.timeout(PROBE_TIMEOUT) },
    );
    return response.ok;
  } catch {
    return false;
  }
}
