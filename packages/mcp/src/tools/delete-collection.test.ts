// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, deleteCollection: vi.fn() };
});

import { deleteCollection } from "@lhremote/core";
import { registerDeleteCollection } from "./delete-collection.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  success: true as const,
  collectionId: 42,
  deleted: true,
};

describe("registerDeleteCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named delete-collection", () => {
    const { server } = createMockServer();
    registerDeleteCollection(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "delete-collection",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerDeleteCollection(server);
    vi.mocked(deleteCollection).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("delete-collection");
    const result = await handler({ collectionId: 42, cdpPort: 9222 });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerDeleteCollection(server);
    vi.mocked(deleteCollection).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("delete-collection");
    const result = (await handler({
      collectionId: 42,
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to delete collection");
  });

  describeInfrastructureErrors(
    registerDeleteCollection,
    "delete-collection",
    () => ({ collectionId: 42, cdpPort: 9222 }),
    (error) => vi.mocked(deleteCollection).mockRejectedValue(error),
    "Failed to delete collection",
  );
});
