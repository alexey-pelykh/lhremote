// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, describe, expect, it, vi } from "vitest";
import { isCdpPort } from "./cdp-port.js";

describe("isCdpPort", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Each test below stubs `fetch` in its own body, and `vi.stubGlobal` is
    // undone by neither reset nor restore — so without this the previous
    // test's stub is what a test that set none would receive, and the Tier-1
    // network guard stays displaced for the rest of the file (#935).
    // `isCdpPort()` is the `catch { return false; }` shape that guard records
    // blocked calls for, so displacing it here loses the one mechanism that
    // would report a real call.
    vi.unstubAllGlobals();
  });

  it("should return true when the port responds with ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true }),
    );

    expect(await isCdpPort(9222)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9222/json/list",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("should return false when the port responds with non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false }),
    );

    expect(await isCdpPort(9222)).toBe(false);
  });

  it("should return false when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    expect(await isCdpPort(9222)).toBe(false);
  });
});
