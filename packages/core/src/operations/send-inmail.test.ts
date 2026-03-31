// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ephemeral-action.js", () => ({
  executeEphemeralAction: vi.fn(),
}));

import { executeEphemeralAction } from "./ephemeral-action.js";
import { sendInmail } from "./send-inmail.js";

const MOCK_RESULT = { success: true, personId: 42, results: [] };

const MOCK_TEMPLATE = { type: "variants", variants: [{ text: "Hello!" }] };

describe("sendInmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeEphemeralAction).mockResolvedValue(MOCK_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls executeEphemeralAction with InMail action type", async () => {
    const input = {
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    };

    await sendInmail(input);

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InMail",
      input,
      expect.any(Object),
    );
  });

  it("includes messageTemplate in action settings", async () => {
    await sendInmail({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InMail",
      expect.any(Object),
      expect.objectContaining({ messageTemplate: MOCK_TEMPLATE }),
    );
  });

  it("includes subjectTemplate when provided", async () => {
    const subjectTemplate = { type: "variants", variants: [{ text: "Subject" }] };

    await sendInmail({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
      subjectTemplate,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InMail",
      expect.any(Object),
      expect.objectContaining({ subjectTemplate }),
    );
  });

  it("omits subjectTemplate when undefined", async () => {
    await sendInmail({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("subjectTemplate");
  });

  it("includes rejectIfReplied when provided", async () => {
    await sendInmail({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
      rejectIfReplied: true,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InMail",
      expect.any(Object),
      expect.objectContaining({ rejectIfReplied: true }),
    );
  });

  it("omits rejectIfReplied when undefined", async () => {
    await sendInmail({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("rejectIfReplied");
  });

  it("includes proceedOnOutOfCredits when provided", async () => {
    await sendInmail({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
      proceedOnOutOfCredits: false,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "InMail",
      expect.any(Object),
      expect.objectContaining({ proceedOnOutOfCredits: false }),
    );
  });

  it("omits proceedOnOutOfCredits when undefined", async () => {
    await sendInmail({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("proceedOnOutOfCredits");
  });

  it("returns the result from executeEphemeralAction", async () => {
    const result = await sendInmail({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    });

    expect(result).toBe(MOCK_RESULT);
  });

  it("propagates errors from executeEphemeralAction", async () => {
    vi.mocked(executeEphemeralAction).mockRejectedValue(
      new Error("action failed"),
    );

    await expect(
      sendInmail({
        personId: 42,
        cdpPort: 9222,
        messageTemplate: MOCK_TEMPLATE,
      }),
    ).rejects.toThrow("action failed");
  });
});
