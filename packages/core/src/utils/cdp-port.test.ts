// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, describe, expect, it, vi } from "vitest";
import { isCdpPort } from "./cdp-port.js";

describe("isCdpPort", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return true when the port responds with a non-empty targets array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('[{"id":"T1"}]', { status: 200 })),
    );

    expect(await isCdpPort(9222)).toBe(true);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:9222/json/list");
  });

  it("should return false when the port responds with an empty targets array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("[]", { status: 200 })),
    );

    expect(await isCdpPort(9222)).toBe(false);
  });

  it("should return false when the port responds with non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 })),
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
