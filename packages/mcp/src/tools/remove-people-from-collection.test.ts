// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, removePeopleFromCollection: vi.fn() };
});

import { removePeopleFromCollection } from "@lhremote/core";
import { registerRemovePeopleFromCollection } from "./remove-people-from-collection.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  success: true as const,
  collectionId: 1,
  removed: 2,
};

describe("registerRemovePeopleFromCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named remove-people-from-collection", () => {
    const { server } = createMockServer();
    registerRemovePeopleFromCollection(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "remove-people-from-collection",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerRemovePeopleFromCollection(server);
    vi.mocked(removePeopleFromCollection).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("remove-people-from-collection");
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
    registerRemovePeopleFromCollection(server);
    vi.mocked(removePeopleFromCollection).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("remove-people-from-collection");
    const result = (await handler({
      collectionId: 1,
      personIds: [100, 200],
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to remove people from collection");
  });

  describeInfrastructureErrors(
    registerRemovePeopleFromCollection,
    "remove-people-from-collection",
    () => ({ collectionId: 1, personIds: [100, 200], cdpPort: 9222 }),
    (error) =>
      vi.mocked(removePeopleFromCollection).mockRejectedValue(error),
    "Failed to remove people from collection",
  );
});
