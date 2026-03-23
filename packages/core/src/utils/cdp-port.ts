// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Check whether a port exposes a CDP `/json/list` endpoint with at least
 * one target.
 *
 * A port that responds with `200 OK` but an empty targets array (`[]`) is
 * NOT considered a usable CDP port — the application may still be starting
 * or the renderer may not be loaded yet.
 */
export async function isCdpPort(port: number): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/json/list`,
    );
    if (!response.ok) {
      return false;
    }
    const body: unknown = await response.json();
    return Array.isArray(body) && body.length > 0;
  } catch {
    return false;
  }
}
