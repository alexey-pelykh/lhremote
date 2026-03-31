// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, listCollections: vi.fn() };
});

import { listCollections } from "@lhremote/core";
import { registerListCollections } from "./list-collections.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  collections: [
    { id: 1, name: "Prospects", peopleCount: 42, createdAt: "2024-01-15T10:00:00Z" },
    { id: 2, name: "Leads", peopleCount: 10, createdAt: "2024-02-20T14:30:00Z" },
  ],
  total: 2,
};

describe("registerListCollections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named list-collections", () => {
    const { server } = createMockServer();
    registerListCollections(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "list-collections",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerListCollections(server);
    vi.mocked(listCollections).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("list-collections");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerListCollections(server);
    vi.mocked(listCollections).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("list-collections");
    const result = (await handler({
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to list collections");
  });

  describeInfrastructureErrors(
    registerListCollections,
    "list-collections",
    () => ({ cdpPort: 9222 }),
    (error) => vi.mocked(listCollections).mockRejectedValue(error),
    "Failed to list collections",
  );
});
