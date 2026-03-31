// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, importPeopleFromCollection: vi.fn() };
});

import {
  CampaignExecutionError,
  importPeopleFromCollection,
} from "@lhremote/core";
import { registerImportPeopleFromCollection } from "./import-people-from-collection.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_RESULT = {
  success: true as const,
  collectionId: 1,
  campaignId: 14,
  actionId: 85,
  totalUrls: 5,
  imported: 5,
  alreadyInQueue: 0,
  alreadyProcessed: 0,
  failed: 0,
};

describe("registerImportPeopleFromCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named import-people-from-collection", () => {
    const { server } = createMockServer();
    registerImportPeopleFromCollection(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "import-people-from-collection",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerImportPeopleFromCollection(server);
    vi.mocked(importPeopleFromCollection).mockResolvedValue(MOCK_RESULT);

    const handler = getHandler("import-people-from-collection");
    const result = await handler({
      collectionId: 1,
      campaignId: 14,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESULT, null, 2) }],
    });
  });

  it("returns error for CampaignExecutionError", async () => {
    const { server, getHandler } = createMockServer();
    registerImportPeopleFromCollection(server);
    vi.mocked(importPeopleFromCollection).mockRejectedValue(
      new CampaignExecutionError("Campaign 14 has no actions", 14),
    );

    const handler = getHandler("import-people-from-collection");
    const result = await handler({
      collectionId: 1,
      campaignId: 14,
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to import people: Campaign 14 has no actions",
        },
      ],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerImportPeopleFromCollection(server);
    vi.mocked(importPeopleFromCollection).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("import-people-from-collection");
    const result = (await handler({
      collectionId: 1,
      campaignId: 14,
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to import people from collection");
  });

  describeInfrastructureErrors(
    registerImportPeopleFromCollection,
    "import-people-from-collection",
    () => ({ collectionId: 1, campaignId: 14, cdpPort: 9222 }),
    (error) =>
      vi.mocked(importPeopleFromCollection).mockRejectedValue(error),
    "Failed to import people from collection",
  );
});
