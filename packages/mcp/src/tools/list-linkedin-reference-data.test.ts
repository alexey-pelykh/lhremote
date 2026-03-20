// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, beforeEach, vi } from "vitest";

import { registerListLinkedInReferenceData } from "./list-linkedin-reference-data.js";
import { createMockServer } from "./testing/mock-server.js";

function extractText(result: unknown): string {
  const r = result as { content?: Array<{ text?: string }> };
  return r.content?.[0]?.text ?? "";
}

describe("registerListLinkedInReferenceData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a tool named list-linkedin-reference-data", () => {
    const { server } = createMockServer();
    registerListLinkedInReferenceData(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "list-linkedin-reference-data",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns industry reference data", async () => {
    const { server, getHandler } = createMockServer();
    registerListLinkedInReferenceData(server);

    const handler = getHandler("list-linkedin-reference-data");
    const result = await handler({ dataType: "INDUSTRY" });

    const parsed = JSON.parse(extractText(result)) as {
      dataType: string;
      items: unknown[];
    };
    expect(parsed.dataType).toBe("INDUSTRY");
    expect(parsed.items.length).toBeGreaterThan(100);
  });

  it("returns seniority reference data", async () => {
    const { server, getHandler } = createMockServer();
    registerListLinkedInReferenceData(server);

    const handler = getHandler("list-linkedin-reference-data");
    const result = await handler({ dataType: "SENIORITY" });

    const parsed = JSON.parse(extractText(result)) as {
      dataType: string;
      items: unknown[];
    };
    expect(parsed.dataType).toBe("SENIORITY");
    expect(parsed.items).toHaveLength(10);
  });

  it("returns connection degree reference data", async () => {
    const { server, getHandler } = createMockServer();
    registerListLinkedInReferenceData(server);

    const handler = getHandler("list-linkedin-reference-data");
    const result = await handler({ dataType: "CONNECTION_DEGREE" });

    const parsed = JSON.parse(extractText(result)) as {
      dataType: string;
      items: unknown[];
    };
    expect(parsed.dataType).toBe("CONNECTION_DEGREE");
    expect(parsed.items).toHaveLength(3);
  });
});
