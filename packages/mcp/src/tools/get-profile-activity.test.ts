// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getProfileActivity: vi.fn() };
});

import { getProfileActivity } from "@lhremote/core";
import { registerGetProfileActivity } from "./get-profile-activity.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_ACTIVITY = {
  profilePublicId: "johndoe",
  posts: [
    {
      text: "Excited to announce...",
      authorName: "John Doe",
      authorPublicId: null,
      authorHeadline: "CEO at Acme",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      authorProfileUrl: "https://www.linkedin.com/in/johndoe",
      mediaType: null,
      reactionCount: 42,
      commentCount: 8,
      shareCount: 3,
      timestamp: 1679000000000,
      hashtags: [],
    },
  ],
  nextCursor: null,
};

describe("registerGetProfileActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named get-profile-activity", () => {
    const { server } = createMockServer();
    registerGetProfileActivity(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "get-profile-activity",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns activity as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerGetProfileActivity(server);
    vi.mocked(getProfileActivity).mockResolvedValue(MOCK_ACTIVITY);

    const handler = getHandler("get-profile-activity");
    const result = await handler({
      profile: "johndoe",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        { type: "text", text: JSON.stringify(MOCK_ACTIVITY, null, 2) },
      ],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerGetProfileActivity(server);
    vi.mocked(getProfileActivity).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("get-profile-activity");
    const result = (await handler({
      profile: "johndoe",
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to get profile activity");
  });
});
