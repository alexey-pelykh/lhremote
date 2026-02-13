// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

/**
 * Check whether a host string is a loopback address.
 *
 * Recognised loopback patterns:
 * - `localhost` (with or without trailing dot)
 * - IPv4 `127.x.x.x` block
 * - IPv6 `::1` (full, compressed, and bracketed forms)
 */
export function isLoopbackAddress(host: string): boolean {
  const h = host.toLowerCase();

  // localhost (including "localhost.")
  if (h === "localhost" || h === "localhost.") {
    return true;
  }

  // IPv4 loopback: 127.0.0.0/8
  if (h.startsWith("127.")) {
    return true;
  }

  // IPv6 loopback — strip optional brackets
  const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  if (bare === "::1" || bare === "0:0:0:0:0:0:0:1") {
    return true;
  }

  return false;
}
