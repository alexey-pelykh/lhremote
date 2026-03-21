// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    removeConnection: vi.fn(),
  };
});

import {
  type EphemeralActionResult,
  removeConnection,
} from "@lhremote/core";

import { registerRemoveConnection } from "./remove-connection.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { describeEphemeralActionErrors } from "./testing/ephemeral-action-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT: EphemeralActionResult = {
  success: true,
  personId: 100,
  results: [{ id: 1, actionVersionId: 1, personId: 100, result: 1, platform: null, createdAt: "2026-01-01T00:00:00Z", profile: null }],
};

describe("registerRemoveConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named remove-connection", () => {
    const { server } = createMockServer();
    registerRemoveConnection(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "remove-connection",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("removes connection on success", async () => {
    const { server, getHandler } = createMockServer();
    registerRemoveConnection(server);

    vi.mocked(removeConnection).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("remove-connection");
    const result = await handler({ personId: 100, cdpPort: 9222 });

    expect(removeConnection).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 100, cdpPort: 9222 }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error when neither personId nor url provided", async () => {
    const { server, getHandler } = createMockServer();
    registerRemoveConnection(server);

    const handler = getHandler("remove-connection");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Exactly one of personId or url must be provided." }],
    });
  });

  describeInfrastructureErrors(
    registerRemoveConnection,
    "remove-connection",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(removeConnection).mockRejectedValue(error),
    "Failed to remove connection",
  );

  describeEphemeralActionErrors(
    registerRemoveConnection,
    "remove-connection",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(removeConnection).mockRejectedValue(error),
    "Failed to remove connection",
  );
});
