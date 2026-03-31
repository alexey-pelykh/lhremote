// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ephemeral-action.js", () => ({
  executeEphemeralAction: vi.fn(),
}));

import { executeEphemeralAction } from "./ephemeral-action.js";
import { messagePerson } from "./message-person.js";

const MOCK_RESULT = { success: true, personId: 42, results: [] };

const MOCK_TEMPLATE = { type: "variants", variants: [{ text: "Hello!" }] };

describe("messagePerson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeEphemeralAction).mockResolvedValue(MOCK_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls executeEphemeralAction with MessageToPerson action type", async () => {
    const input = {
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    };

    await messagePerson(input);

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "MessageToPerson",
      input,
      expect.any(Object),
    );
  });

  it("includes messageTemplate in action settings", async () => {
    await messagePerson({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "MessageToPerson",
      expect.any(Object),
      expect.objectContaining({ messageTemplate: MOCK_TEMPLATE }),
    );
  });

  it("includes subjectTemplate when provided", async () => {
    const subjectTemplate = { type: "variants", variants: [{ text: "Subject" }] };

    await messagePerson({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
      subjectTemplate,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "MessageToPerson",
      expect.any(Object),
      expect.objectContaining({ subjectTemplate }),
    );
  });

  it("omits subjectTemplate when undefined", async () => {
    await messagePerson({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("subjectTemplate");
  });

  it("includes rejectIfReplied when provided", async () => {
    await messagePerson({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
      rejectIfReplied: true,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "MessageToPerson",
      expect.any(Object),
      expect.objectContaining({ rejectIfReplied: true }),
    );
  });

  it("omits rejectIfReplied when undefined", async () => {
    await messagePerson({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("rejectIfReplied");
  });

  it("includes rejectIfMessaged when provided", async () => {
    await messagePerson({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
      rejectIfMessaged: false,
    });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "MessageToPerson",
      expect.any(Object),
      expect.objectContaining({ rejectIfMessaged: false }),
    );
  });

  it("omits rejectIfMessaged when undefined", async () => {
    await messagePerson({
      personId: 42,
      cdpPort: 9222,
      messageTemplate: MOCK_TEMPLATE,
    });

    const settings = vi.mocked(executeEphemeralAction).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(settings).not.toHaveProperty("rejectIfMessaged");
  });

  it("returns the result from executeEphemeralAction", async () => {
    const result = await messagePerson({
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
      messagePerson({
        personId: 42,
        cdpPort: 9222,
        messageTemplate: MOCK_TEMPLATE,
      }),
    ).rejects.toThrow("action failed");
  });
});
