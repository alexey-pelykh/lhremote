// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, hideFeedAuthor: vi.fn() };
});

import { hideFeedAuthor } from "@lhremote/core";
import { registerHideFeedAuthor } from "./hide-feed-author.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  success: true as const,
  postUrl:
    "https://www.linkedin.com/feed/update/urn:li:activity:123/",
  hiddenName: "John Doe",
};

describe("registerHideFeedAuthor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named hide-feed-author", () => {
    const { server } = createMockServer();
    registerHideFeedAuthor(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "hide-feed-author",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerHideFeedAuthor(server);
    vi.mocked(hideFeedAuthor).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("hide-feed-author");
    const result = await handler({
      postUrl:
        "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerHideFeedAuthor(server);
    vi.mocked(hideFeedAuthor).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("hide-feed-author");
    const result = (await handler({
      postUrl:
        "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to hide feed author");
  });

  describeInfrastructureErrors(
    registerHideFeedAuthor,
    "hide-feed-author",
    () => ({
      postUrl:
        "https://www.linkedin.com/feed/update/urn:li:activity:123/",
      cdpPort: 9222,
    }),
    (error) => vi.mocked(hideFeedAuthor).mockRejectedValue(error),
    "Failed to hide feed author",
  );
});
