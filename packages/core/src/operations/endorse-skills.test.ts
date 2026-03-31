// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ephemeral-action.js", () => ({
  executeEphemeralAction: vi.fn(),
}));

import { executeEphemeralAction } from "./ephemeral-action.js";
import { endorseSkills } from "./endorse-skills.js";

const MOCK_RESULT = { success: true, personId: 42, results: [] };

describe("endorseSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeEphemeralAction).mockResolvedValue(MOCK_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls executeEphemeralAction with EndorseSkills action type", async () => {
    const input = { personId: 42, cdpPort: 9222 };

    await endorseSkills(input);

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "EndorseSkills",
      input,
      expect.any(Object),
    );
  });

  it("defaults skipIfNotEndorsable to true", async () => {
    await endorseSkills({ personId: 42, cdpPort: 9222 });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "EndorseSkills",
      expect.any(Object),
      expect.objectContaining({ skipIfNotEndorsable: true }),
    );
  });

  it("passes explicit skipIfNotEndorsable value", async () => {
    await endorseSkills({
      personId: 42,
      cdpPort: 9222,
      skipIfNotEndorsable: false,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "EndorseSkills",
      expect.any(Object),
      expect.objectContaining({ skipIfNotEndorsable: false }),
    );
  });

  it("includes skillNames when provided", async () => {
    await endorseSkills({
      personId: 42,
      cdpPort: 9222,
      skillNames: ["TypeScript", "Node.js"],
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "EndorseSkills",
      expect.any(Object),
      expect.objectContaining({ skillNames: ["TypeScript", "Node.js"] }),
    );
  });

  it("omits skillNames when undefined", async () => {
    await endorseSkills({ personId: 42, cdpPort: 9222 });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("skillNames");
  });

  it("includes limit when provided", async () => {
    await endorseSkills({
      personId: 42,
      cdpPort: 9222,
      limit: 5,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "EndorseSkills",
      expect.any(Object),
      expect.objectContaining({ limit: 5 }),
    );
  });

  it("omits limit when undefined", async () => {
    await endorseSkills({ personId: 42, cdpPort: 9222 });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("limit");
  });

  it("returns the result from executeEphemeralAction", async () => {
    const result = await endorseSkills({ personId: 42, cdpPort: 9222 });

    expect(result).toBe(MOCK_RESULT);
  });

  it("propagates errors from executeEphemeralAction", async () => {
    vi.mocked(executeEphemeralAction).mockRejectedValue(
      new Error("action failed"),
    );

    await expect(
      endorseSkills({ personId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("action failed");
  });
});
