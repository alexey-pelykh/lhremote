// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ephemeral-action.js", () => ({
  executeEphemeralAction: vi.fn(),
}));

import { executeEphemeralAction } from "./ephemeral-action.js";
import { likePersonPosts } from "./like-person-posts.js";

const MOCK_RESULT = { success: true, personId: 42, results: [] };

describe("likePersonPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeEphemeralAction).mockResolvedValue(MOCK_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls executeEphemeralAction with PersonPostsLiker action type", async () => {
    const input = { personId: 42, cdpPort: 9222 };

    await likePersonPosts(input);

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "PersonPostsLiker",
      input,
      expect.any(Object),
    );
  });

  it("defaults skipIfNotLiked to true", async () => {
    await likePersonPosts({ personId: 42, cdpPort: 9222 });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "PersonPostsLiker",
      expect.any(Object),
      expect.objectContaining({ skipIfNotLiked: true }),
    );
  });

  it("passes explicit skipIfNotLiked value", async () => {
    await likePersonPosts({
      personId: 42,
      cdpPort: 9222,
      skipIfNotLiked: false,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "PersonPostsLiker",
      expect.any(Object),
      expect.objectContaining({ skipIfNotLiked: false }),
    );
  });

  it("includes numberOfArticles when provided", async () => {
    await likePersonPosts({
      personId: 42,
      cdpPort: 9222,
      numberOfArticles: 3,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "PersonPostsLiker",
      expect.any(Object),
      expect.objectContaining({ numberOfArticles: 3 }),
    );
  });

  it("includes numberOfPosts when provided", async () => {
    await likePersonPosts({
      personId: 42,
      cdpPort: 9222,
      numberOfPosts: 5,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "PersonPostsLiker",
      expect.any(Object),
      expect.objectContaining({ numberOfPosts: 5 }),
    );
  });

  it("includes maxAgeOfArticles when provided", async () => {
    await likePersonPosts({
      personId: 42,
      cdpPort: 9222,
      maxAgeOfArticles: 30,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "PersonPostsLiker",
      expect.any(Object),
      expect.objectContaining({ maxAgeOfArticles: 30 }),
    );
  });

  it("includes maxAgeOfPosts when provided", async () => {
    await likePersonPosts({
      personId: 42,
      cdpPort: 9222,
      maxAgeOfPosts: 14,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "PersonPostsLiker",
      expect.any(Object),
      expect.objectContaining({ maxAgeOfPosts: 14 }),
    );
  });

  it("includes shouldAddComment when provided", async () => {
    await likePersonPosts({
      personId: 42,
      cdpPort: 9222,
      shouldAddComment: true,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "PersonPostsLiker",
      expect.any(Object),
      expect.objectContaining({ shouldAddComment: true }),
    );
  });

  it("includes messageTemplate when provided", async () => {
    const messageTemplate = { type: "variants", variants: [{ text: "Great post!" }] };

    await likePersonPosts({
      personId: 42,
      cdpPort: 9222,
      messageTemplate,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "PersonPostsLiker",
      expect.any(Object),
      expect.objectContaining({ messageTemplate }),
    );
  });

  it("omits optional fields when undefined", async () => {
    await likePersonPosts({ personId: 42, cdpPort: 9222 });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("numberOfArticles");
    expect(settings).not.toHaveProperty("numberOfPosts");
    expect(settings).not.toHaveProperty("maxAgeOfArticles");
    expect(settings).not.toHaveProperty("maxAgeOfPosts");
    expect(settings).not.toHaveProperty("shouldAddComment");
    expect(settings).not.toHaveProperty("messageTemplate");
  });

  it("returns the result from executeEphemeralAction", async () => {
    const result = await likePersonPosts({ personId: 42, cdpPort: 9222 });

    expect(result).toBe(MOCK_RESULT);
  });

  it("propagates errors from executeEphemeralAction", async () => {
    vi.mocked(executeEphemeralAction).mockRejectedValue(
      new Error("action failed"),
    );

    await expect(
      likePersonPosts({ personId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("action failed");
  });
});
