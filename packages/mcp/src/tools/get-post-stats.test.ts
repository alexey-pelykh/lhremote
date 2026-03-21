// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getPostStats: vi.fn() };
});

import { getPostStats } from "@lhremote/core";
import { registerGetPostStats } from "./get-post-stats.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_STATS = {
  stats: {
    postUrn: "urn:li:activity:7123456789012345678",
    reactionCount: 25,
    reactionsByType: [
      { type: "LIKE", count: 15 },
      { type: "PRAISE", count: 5 },
      { type: "EMPATHY", count: 5 },
    ],
    commentCount: 10,
    shareCount: 3,
  },
};

describe("registerGetPostStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named get-post-stats", () => {
    const { server } = createMockServer();
    registerGetPostStats(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "get-post-stats",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns stats as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerGetPostStats(server);
    vi.mocked(getPostStats).mockResolvedValue(MOCK_STATS);

    const handler = getHandler("get-post-stats");
    const result = await handler({
      postUrl: "urn:li:activity:7123456789012345678",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_STATS, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerGetPostStats(server);
    vi.mocked(getPostStats).mockRejectedValue(new Error("connection refused"));

    const handler = getHandler("get-post-stats");
    const result = (await handler({
      postUrl: "urn:li:activity:7123456789012345678",
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to get post stats");
  });
});
