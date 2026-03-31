// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ephemeral-action.js", () => ({
  executeEphemeralAction: vi.fn(),
}));

import { executeEphemeralAction } from "./ephemeral-action.js";
import { followPerson } from "./follow-person.js";

const MOCK_RESULT = { success: true, personId: 42, results: [] };

describe("followPerson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeEphemeralAction).mockResolvedValue(MOCK_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls executeEphemeralAction with Follow action type", async () => {
    const input = { personId: 42, cdpPort: 9222 };

    await followPerson(input);

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "Follow",
      input,
      expect.any(Object),
    );
  });

  it("defaults skipIfUnfollowable to true", async () => {
    await followPerson({ personId: 42, cdpPort: 9222 });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "Follow",
      expect.any(Object),
      expect.objectContaining({ skipIfUnfollowable: true }),
    );
  });

  it("passes explicit skipIfUnfollowable value", async () => {
    await followPerson({
      personId: 42,
      cdpPort: 9222,
      skipIfUnfollowable: false,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "Follow",
      expect.any(Object),
      expect.objectContaining({ skipIfUnfollowable: false }),
    );
  });

  it("includes mode when provided", async () => {
    await followPerson({
      personId: 42,
      cdpPort: 9222,
      mode: "unfollow",
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "Follow",
      expect.any(Object),
      expect.objectContaining({ mode: "unfollow" }),
    );
  });

  it("omits mode when undefined", async () => {
    await followPerson({ personId: 42, cdpPort: 9222 });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("mode");
  });

  it("returns the result from executeEphemeralAction", async () => {
    const result = await followPerson({ personId: 42, cdpPort: 9222 });

    expect(result).toBe(MOCK_RESULT);
  });

  it("propagates errors from executeEphemeralAction", async () => {
    vi.mocked(executeEphemeralAction).mockRejectedValue(
      new Error("action failed"),
    );

    await expect(
      followPerson({ personId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("action failed");
  });
});
