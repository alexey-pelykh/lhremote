// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, addPeopleToCollection: vi.fn() };
});

import { addPeopleToCollection } from "@lhremote/core";
import { registerAddPeopleToCollection } from "./add-people-to-collection.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  success: true as const,
  collectionId: 1,
  added: 2,
  alreadyInCollection: 0,
};

describe("registerAddPeopleToCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named add-people-to-collection", () => {
    const { server } = createMockServer();
    registerAddPeopleToCollection(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "add-people-to-collection",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerAddPeopleToCollection(server);
    vi.mocked(addPeopleToCollection).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("add-people-to-collection");
    const result = await handler({
      collectionId: 1,
      personIds: [100, 200],
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerAddPeopleToCollection(server);
    vi.mocked(addPeopleToCollection).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("add-people-to-collection");
    const result = (await handler({
      collectionId: 1,
      personIds: [100, 200],
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to add people to collection");
  });

  describeInfrastructureErrors(
    registerAddPeopleToCollection,
    "add-people-to-collection",
    () => ({ collectionId: 1, personIds: [100, 200], cdpPort: 9222 }),
    (error) => vi.mocked(addPeopleToCollection).mockRejectedValue(error),
    "Failed to add people to collection",
  );
});
