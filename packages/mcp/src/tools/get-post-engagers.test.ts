// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getPostEngagers: vi.fn() };
});

import { getPostEngagers } from "@lhremote/core";
import { registerGetPostEngagers } from "./get-post-engagers.js";
import { createMockServer } from "./testing/mock-server.js";
import { describeAccountIdForwarding } from "./testing/account-id-forwarding.js";

const MOCK_ENGAGERS = {
  postUrn: "urn:li:activity:7123456789012345678",
  engagers: [
    {
      firstName: "Jane",
      lastName: "Doe",
      publicId: "janedoe",
      headline: "Software Engineer at ACME",
      engagementType: "LIKE",
    },
    {
      firstName: "John",
      lastName: "Smith",
      publicId: "johnsmith",
      headline: "Product Manager",
      engagementType: "PRAISE",
    },
  ],
  paging: { start: 0, count: 20, total: 2 },
  // Always present on a real result, including when nothing is short — the
  // field reports the absence of a contradiction rather than vanishing on the
  // healthy path where nobody would learn to look for it (#874). `null` is not
  // a completeness guarantee; see `GetPostEngagersOutput.shortfall`.
  shortfall: null,
};

describe("registerGetPostEngagers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named get-post-engagers", () => {
    const { server } = createMockServer();
    registerGetPostEngagers(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "get-post-engagers",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns engagers as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerGetPostEngagers(server);
    vi.mocked(getPostEngagers).mockResolvedValue(MOCK_ENGAGERS);

    const handler = getHandler("get-post-engagers");
    const result = await handler({
      postUrl: "urn:li:activity:7123456789012345678",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      content: [
        { type: "text", text: JSON.stringify(MOCK_ENGAGERS, null, 2) },
      ],
    });
  });

  // The populated case, asserted against a LITERAL rather than against
  // `JSON.stringify(fixture)`. The success test above compares two expressions
  // derived from the same object, so it cannot fail on anything about
  // `shortfall`; this one names the four fields and their values outright, so a
  // handler that dropped, renamed or flattened the record fails here.
  //
  // Worth having on this boundary specifically: the tool description makes four
  // claims about `shortfall`, and the MCP surface is the only place a consumer
  // ever reads it — there is no CLI command for this tool (#874).
  it("serializes a populated shortfall through the tool boundary", async () => {
    const { server, getHandler } = createMockServer();
    registerGetPostEngagers(server);
    vi.mocked(getPostEngagers).mockResolvedValue({
      ...MOCK_ENGAGERS,
      paging: { start: 0, count: 2, total: 50 },
      shortfall: {
        collected: 3,
        requested: 20,
        cardinal: 50,
        stoppedBecause: "scroll-declined",
      },
    });

    const handler = getHandler("get-post-engagers");
    const result = (await handler({
      postUrl: "urn:li:activity:7123456789012345678",
      cdpPort: 9222,
    })) as { content: { type: string; text: string }[] };

    const parsed = JSON.parse(
      (result.content[0] as { text: string }).text,
    ) as Record<string, unknown>;

    expect(parsed.shortfall).toEqual({
      collected: 3,
      requested: 20,
      cardinal: 50,
      stoppedBecause: "scroll-declined",
    });
  });

  it("passes pagination parameters to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerGetPostEngagers(server);
    vi.mocked(getPostEngagers).mockResolvedValue(MOCK_ENGAGERS);

    const handler = getHandler("get-post-engagers");
    await handler({
      postUrl: "urn:li:activity:7123456789012345678",
      start: 10,
      count: 5,
      cdpPort: 9222,
    });

    expect(getPostEngagers).toHaveBeenCalledWith(
      expect.objectContaining({ start: 10, count: 5 }),
    );
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerGetPostEngagers(server);
    vi.mocked(getPostEngagers).mockRejectedValue(
      new Error("connection refused"),
    );

    const handler = getHandler("get-post-engagers");
    const result = (await handler({
      postUrl: "urn:li:activity:7123456789012345678",
      cdpPort: 9222,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to get post engagers");
  });
  describeAccountIdForwarding({
    registerTool: registerGetPostEngagers,
    toolName: "get-post-engagers",
    mock: vi.mocked(getPostEngagers),
    baseArgs: { postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:1/" },
  });

});
