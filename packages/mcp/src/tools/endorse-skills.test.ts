// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    endorseSkills: vi.fn(),
  };
});

import {
  type EphemeralActionResult,
  endorseSkills,
} from "@lhremote/core";

import { registerEndorseSkills } from "./endorse-skills.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { describeEphemeralActionErrors } from "./testing/ephemeral-action-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT: EphemeralActionResult = {
  success: true,
  personId: 100,
  results: [{ id: 1, actionVersionId: 1, personId: 100, result: 1, platform: null, createdAt: "2026-01-01T00:00:00Z", profile: null }],
};

describe("registerEndorseSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named endorse-skills", () => {
    const { server } = createMockServer();
    registerEndorseSkills(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "endorse-skills",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("endorses skills on success", async () => {
    const { server, getHandler } = createMockServer();
    registerEndorseSkills(server);

    vi.mocked(endorseSkills).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("endorse-skills");
    const result = await handler({ personId: 100, limit: 3, cdpPort: 9222 });

    expect(endorseSkills).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 100, limit: 3, cdpPort: 9222 }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error when neither personId nor url provided", async () => {
    const { server, getHandler } = createMockServer();
    registerEndorseSkills(server);

    const handler = getHandler("endorse-skills");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Exactly one of personId or url must be provided." }],
    });
  });

  describeInfrastructureErrors(
    registerEndorseSkills,
    "endorse-skills",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(endorseSkills).mockRejectedValue(error),
    "Failed to endorse skills",
  );

  describeEphemeralActionErrors(
    registerEndorseSkills,
    "endorse-skills",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(endorseSkills).mockRejectedValue(error),
    "Failed to endorse skills",
  );
});
