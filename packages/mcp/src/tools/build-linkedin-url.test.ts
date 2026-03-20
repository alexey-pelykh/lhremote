// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, beforeEach, vi } from "vitest";

import { registerBuildLinkedInUrl } from "./build-linkedin-url.js";
import { createMockServer } from "./testing/mock-server.js";

function extractText(result: unknown): string {
  const r = result as { content?: Array<{ text?: string }> };
  return r.content?.[0]?.text ?? "";
}

describe("registerBuildLinkedInUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a tool named build-linkedin-url", () => {
    const { server } = createMockServer();
    registerBuildLinkedInUrl(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "build-linkedin-url",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("builds SearchPage URL with keywords", async () => {
    const { server, getHandler } = createMockServer();
    registerBuildLinkedInUrl(server);

    const handler = getHandler("build-linkedin-url");
    const result = await handler({
      sourceType: "SearchPage",
      keywords: "software engineer",
    });

    const parsed = JSON.parse(extractText(result)) as {
      url: string;
      sourceType: string;
    };
    expect(parsed.sourceType).toBe("SearchPage");
    expect(parsed.url).toContain("/search/results/people/");
    expect(parsed.url).toContain("keywords=");
  });

  it("builds fixed URL for MyConnections", async () => {
    const { server, getHandler } = createMockServer();
    registerBuildLinkedInUrl(server);

    const handler = getHandler("build-linkedin-url");
    const result = await handler({
      sourceType: "MyConnections",
    });

    const parsed = JSON.parse(extractText(result)) as {
      url: string;
      sourceType: string;
    };
    expect(parsed.sourceType).toBe("MyConnections");
    expect(parsed.url).toContain("/connections/");
  });

  it("builds parameterised URL for OrganizationPeople", async () => {
    const { server, getHandler } = createMockServer();
    registerBuildLinkedInUrl(server);

    const handler = getHandler("build-linkedin-url");
    const result = await handler({
      sourceType: "OrganizationPeople",
      slug: "google",
    });

    const parsed = JSON.parse(extractText(result)) as {
      url: string;
      sourceType: string;
    };
    expect(parsed.url).toBe(
      "https://www.linkedin.com/company/google/people/",
    );
  });

  it("returns error for invalid sourceType", async () => {
    const { server, getHandler } = createMockServer();
    registerBuildLinkedInUrl(server);

    const handler = getHandler("build-linkedin-url");
    const result = await handler({
      sourceType: "InvalidType",
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(extractText(result)).toContain("Unknown source type");
  });

  it("returns error when required param is missing", async () => {
    const { server, getHandler } = createMockServer();
    registerBuildLinkedInUrl(server);

    const handler = getHandler("build-linkedin-url");
    const result = await handler({
      sourceType: "OrganizationPeople",
      // missing slug
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(extractText(result)).toContain("Missing required parameter");
  });

  it("builds SNSearchPage URL with filters", async () => {
    const { server, getHandler } = createMockServer();
    registerBuildLinkedInUrl(server);

    const handler = getHandler("build-linkedin-url");
    const result = await handler({
      sourceType: "SNSearchPage",
      keywords: "engineer",
      filters: [
        {
          type: "CURRENT_COMPANY",
          values: [
            {
              id: "urn:li:organization:1441",
              text: "Google",
              selectionType: "INCLUDED",
            },
          ],
        },
      ],
    });

    const parsed = JSON.parse(extractText(result)) as {
      url: string;
      sourceType: string;
    };
    expect(parsed.sourceType).toBe("SNSearchPage");
    expect(parsed.url).toContain("/sales/search/people");
  });
});
