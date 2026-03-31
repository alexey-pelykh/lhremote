// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ephemeral-action.js", () => ({
  executeEphemeralAction: vi.fn(),
}));

import { executeEphemeralAction } from "./ephemeral-action.js";
import { removeConnection } from "./remove-connection.js";

const MOCK_RESULT = { success: true, personId: 42, results: [] };

describe("removeConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeEphemeralAction).mockResolvedValue(MOCK_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls executeEphemeralAction with RemoveFromFirstConnection action type", async () => {
    const input = { personId: 42, cdpPort: 9222 };

    await removeConnection(input);

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "RemoveFromFirstConnection",
      input,
    );
  });

  it("does not pass action settings", async () => {
    await removeConnection({ personId: 42, cdpPort: 9222 });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "RemoveFromFirstConnection",
      expect.any(Object),
    );
    expect(vi.mocked(executeEphemeralAction).mock.calls[0]).toHaveLength(2);
  });

  it("forwards url-based input", async () => {
    const input = {
      url: "https://www.linkedin.com/in/test",
      cdpPort: 9222,
    };

    await removeConnection(input);

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "RemoveFromFirstConnection",
      input,
    );
  });

  it("returns the result from executeEphemeralAction", async () => {
    const result = await removeConnection({ personId: 42, cdpPort: 9222 });

    expect(result).toBe(MOCK_RESULT);
  });

  it("propagates errors from executeEphemeralAction", async () => {
    vi.mocked(executeEphemeralAction).mockRejectedValue(
      new Error("action failed"),
    );

    await expect(
      removeConnection({ personId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("action failed");
  });
});
