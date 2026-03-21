// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getThrottleStatus: vi.fn() };
});

import { getThrottleStatus } from "@lhremote/core";
import { registerGetThrottleStatus } from "./get-throttle-status.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerGetThrottleStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named get-throttle-status", () => {
    const { server } = createMockServer();
    registerGetThrottleStatus(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "get-throttle-status",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns status as JSON when not throttled", async () => {
    const { server, getHandler } = createMockServer();
    registerGetThrottleStatus(server);
    vi.mocked(getThrottleStatus).mockResolvedValue({ throttled: false, since: null });

    const handler = getHandler("get-throttle-status");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ throttled: false, since: null }, null, 2) }],
    });
  });

  it("returns status as JSON when throttled", async () => {
    const { server, getHandler } = createMockServer();
    registerGetThrottleStatus(server);
    const since = "2026-03-21T10:00:00.000Z";
    vi.mocked(getThrottleStatus).mockResolvedValue({ throttled: true, since });

    const handler = getHandler("get-throttle-status");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ throttled: true, since }, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerGetThrottleStatus(server);
    vi.mocked(getThrottleStatus).mockRejectedValue(new Error("instance not running"));

    const handler = getHandler("get-throttle-status");
    const result = await handler({ cdpPort: 9222 }) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to get throttle status");
  });
});
