// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveLinkedInEntity: vi.fn(),
  };
});

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { resolveLinkedInEntity } from "@lhremote/core";

import { registerResolveLinkedInEntity } from "./resolve-linkedin-entity.js";
import { createMockServer } from "./testing/mock-server.js";

function extractText(result: unknown): string {
  const r = result as { content?: Array<{ text?: string }> };
  return r.content?.[0]?.text ?? "";
}

describe("registerResolveLinkedInEntity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named resolve-linkedin-entity", () => {
    const { server } = createMockServer();
    registerResolveLinkedInEntity(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "resolve-linkedin-entity",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("resolves entity and returns matches", async () => {
    const { server, getHandler } = createMockServer();
    registerResolveLinkedInEntity(server);

    vi.mocked(resolveLinkedInEntity).mockResolvedValue({
      matches: [
        { id: "1441", name: "Google", type: "COMPANY" },
        { id: "1035", name: "Google Cloud", type: "COMPANY" },
      ],
      strategy: "public",
    });

    const handler = getHandler("resolve-linkedin-entity");
    const result = await handler({
      query: "Google",
      entityType: "COMPANY",
      cdpPort: 9222,
    });

    const parsed = JSON.parse(extractText(result)) as {
      matches: Array<{ id: string; name: string }>;
      strategy: string;
    };
    expect(parsed.matches).toHaveLength(2);
    expect(parsed.matches[0]?.name).toBe("Google");
    expect(parsed.strategy).toBe("public");
  });

  it("returns error on resolution failure", async () => {
    const { server, getHandler } = createMockServer();
    registerResolveLinkedInEntity(server);

    vi.mocked(resolveLinkedInEntity).mockRejectedValue(
      new Error("Network timeout"),
    );

    const handler = getHandler("resolve-linkedin-entity");
    const result = await handler({
      query: "Test",
      entityType: "COMPANY",
      cdpPort: 9222,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(extractText(result)).toContain("Failed to resolve entity");
  });
});
