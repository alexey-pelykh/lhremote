// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, createCollection: vi.fn() };
});

import { createCollection } from "@lhremote/core";
import { registerCreateCollection } from "./create-collection.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  success: true as const,
  collectionId: 42,
  name: "My List",
};

describe("registerCreateCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named create-collection", () => {
    const { server } = createMockServer();
    registerCreateCollection(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "create-collection",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerCreateCollection(server);
    vi.mocked(createCollection).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("create-collection");
    const result = await handler({ name: "My List", cdpPort: 9222 });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerCreateCollection(server);
    vi.mocked(createCollection).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("create-collection");
    const result = (await handler({
      name: "My List",
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to create collection");
  });

  describeInfrastructureErrors(
    registerCreateCollection,
    "create-collection",
    () => ({ name: "My List", cdpPort: 9222 }),
    (error) => vi.mocked(createCollection).mockRejectedValue(error),
    "Failed to create collection",
  );
});
