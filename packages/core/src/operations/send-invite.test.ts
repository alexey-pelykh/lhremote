// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ephemeral-action.js", () => ({
  executeEphemeralAction: vi.fn(),
}));

import { executeEphemeralAction } from "./ephemeral-action.js";
import { sendInvite } from "./send-invite.js";

const MOCK_RESULT = { success: true, personId: 42, results: [] };

describe("sendInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeEphemeralAction).mockResolvedValue(MOCK_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls executeEphemeralAction with InvitePerson action type", async () => {
    const input = { personId: 42, cdpPort: 9222 };

    await sendInvite(input);

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InvitePerson",
      input,
      expect.any(Object),
    );
  });

  it("defaults messageTemplate to empty variants", async () => {
    await sendInvite({ personId: 42, cdpPort: 9222 });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InvitePerson",
      expect.any(Object),
      expect.objectContaining({
        messageTemplate: { type: "variants", variants: [] },
      }),
    );
  });

  it("passes explicit messageTemplate", async () => {
    const messageTemplate = { type: "variants", variants: [{ text: "Hi!" }] };

    await sendInvite({
      personId: 42,
      cdpPort: 9222,
      messageTemplate,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InvitePerson",
      expect.any(Object),
      expect.objectContaining({ messageTemplate }),
    );
  });

  it("defaults saveAsLeadSN to false", async () => {
    await sendInvite({ personId: 42, cdpPort: 9222 });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InvitePerson",
      expect.any(Object),
      expect.objectContaining({ saveAsLeadSN: false }),
    );
  });

  it("passes explicit saveAsLeadSN value", async () => {
    await sendInvite({
      personId: 42,
      cdpPort: 9222,
      saveAsLeadSN: true,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InvitePerson",
      expect.any(Object),
      expect.objectContaining({ saveAsLeadSN: true }),
    );
  });

  it("returns the result from executeEphemeralAction", async () => {
    const result = await sendInvite({ personId: 42, cdpPort: 9222 });

    expect(result).toBe(MOCK_RESULT);
  });

  it("propagates errors from executeEphemeralAction", async () => {
    vi.mocked(executeEphemeralAction).mockRejectedValue(
      new Error("action failed"),
    );

    await expect(
      sendInvite({ personId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("action failed");
  });
});
