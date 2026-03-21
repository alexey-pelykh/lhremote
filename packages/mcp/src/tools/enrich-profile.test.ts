// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    enrichProfile: vi.fn(),
  };
});

import {
  type EphemeralActionResult,
  enrichProfile,
} from "@lhremote/core";

import { registerEnrichProfile } from "./enrich-profile.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { describeEphemeralActionErrors } from "./testing/ephemeral-action-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT: EphemeralActionResult = {
  success: true,
  personId: 100,
  results: [{ id: 1, actionVersionId: 1, personId: 100, result: 1, platform: null, createdAt: "2026-01-01T00:00:00Z", profile: null }],
};

describe("registerEnrichProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named enrich-profile", () => {
    const { server } = createMockServer();
    registerEnrichProfile(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "enrich-profile",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("enriches profile on success", async () => {
    const { server, getHandler } = createMockServer();
    registerEnrichProfile(server);

    vi.mocked(enrichProfile).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("enrich-profile");
    const result = await handler({
      personId: 100,
      companies: { shouldEnrich: true },
      cdpPort: 9222,
    });

    expect(enrichProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 100,
        companies: { shouldEnrich: true },
        cdpPort: 9222,
      }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error when neither personId nor url provided", async () => {
    const { server, getHandler } = createMockServer();
    registerEnrichProfile(server);

    const handler = getHandler("enrich-profile");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Exactly one of personId or url must be provided." }],
    });
  });

  describeInfrastructureErrors(
    registerEnrichProfile,
    "enrich-profile",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(enrichProfile).mockRejectedValue(error),
    "Failed to enrich profile",
  );

  describeEphemeralActionErrors(
    registerEnrichProfile,
    "enrich-profile",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(enrichProfile).mockRejectedValue(error),
    "Failed to enrich profile",
  );
});
