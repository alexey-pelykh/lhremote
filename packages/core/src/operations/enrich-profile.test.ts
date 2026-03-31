// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ephemeral-action.js", () => ({
  executeEphemeralAction: vi.fn(),
}));

import { executeEphemeralAction } from "./ephemeral-action.js";
import { enrichProfile } from "./enrich-profile.js";

const MOCK_RESULT = { success: true, personId: 42, results: [] };

describe("enrichProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeEphemeralAction).mockResolvedValue(MOCK_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls executeEphemeralAction with DataEnrichment action type", async () => {
    const input = { personId: 42, cdpPort: 9222 };

    await enrichProfile(input);

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "DataEnrichment",
      input,
      expect.any(Object),
    );
  });

  it("defaults all categories to shouldEnrich: false", async () => {
    await enrichProfile({ personId: 42, cdpPort: 9222 });

    const defaults = { shouldEnrich: false };
    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "DataEnrichment",
      expect.any(Object),
      expect.objectContaining({
        profileInfo: defaults,
        phones: defaults,
        socials: defaults,
        companies: defaults,
      }),
    );
  });

  it("defaults emails with personal and business types", async () => {
    await enrichProfile({ personId: 42, cdpPort: 9222 });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "DataEnrichment",
      expect.any(Object),
      expect.objectContaining({
        emails: { shouldEnrich: false, types: ["personal", "business"] },
      }),
    );
  });

  it("passes explicit profileInfo category", async () => {
    const profileInfo = { shouldEnrich: true };

    await enrichProfile({ personId: 42, cdpPort: 9222, profileInfo });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "DataEnrichment",
      expect.any(Object),
      expect.objectContaining({ profileInfo }),
    );
  });

  it("passes explicit phones category", async () => {
    const phones = { shouldEnrich: true };

    await enrichProfile({ personId: 42, cdpPort: 9222, phones });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "DataEnrichment",
      expect.any(Object),
      expect.objectContaining({ phones }),
    );
  });

  it("passes explicit emails category", async () => {
    const emails = { shouldEnrich: true, types: ["personal"] };

    await enrichProfile({ personId: 42, cdpPort: 9222, emails });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "DataEnrichment",
      expect.any(Object),
      expect.objectContaining({ emails }),
    );
  });

  it("passes explicit socials category", async () => {
    const socials = { shouldEnrich: true };

    await enrichProfile({ personId: 42, cdpPort: 9222, socials });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "DataEnrichment",
      expect.any(Object),
      expect.objectContaining({ socials }),
    );
  });

  it("passes explicit companies category", async () => {
    const companies = { shouldEnrich: true, actualDate: 1700000000 };

    await enrichProfile({ personId: 42, cdpPort: 9222, companies });

    expect(executeEphemeralAction).toHaveBeenCalledWith(
      "DataEnrichment",
      expect.any(Object),
      expect.objectContaining({ companies }),
    );
  });

  it("returns the result from executeEphemeralAction", async () => {
    const result = await enrichProfile({ personId: 42, cdpPort: 9222 });

    expect(result).toBe(MOCK_RESULT);
  });

  it("propagates errors from executeEphemeralAction", async () => {
    vi.mocked(executeEphemeralAction).mockRejectedValue(
      new Error("action failed"),
    );

    await expect(
      enrichProfile({ personId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("action failed");
  });
});
