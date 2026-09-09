// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, beforeEach, vi } from "vitest";

// Partial mock that DELEGATES to the real implementation by default, so every
// test below still exercises the genuine builder.  Only the coercion test
// overrides it, and only for its own call.
vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, buildLinkedInUrl: vi.fn(actual.buildLinkedInUrl) };
});

import * as core from "@lhremote/core";
import { buildLinkedInUrl } from "@lhremote/core";
import { registerBuildLinkedInUrl } from "./build-linkedin-url.js";
import { createMockServer } from "./testing/mock-server.js";

/**
 * An `Error` whose `message` is `value`.
 *
 * `new Error(value)` would coerce it, which is the very step under test.  The
 * construction mirrors `error-message.test.ts` § `errorMessage totality`, and
 * so does its warrant: `message` is typed `string` but is not one by
 * construction -- a subclass assigning `this.message`, an error rehydrated
 * across a worker or IPC boundary, and a `Proxy` can each produce one.  No
 * producer in this repo builds one today; this pins the contract `unknown`
 * promises to accept, not an observed source.
 */
function errorWithMessage(value: unknown): Error {
  const error = new Error("placeholder");
  Object.defineProperty(error, "message", { value, configurable: true });
  return error;
}

function extractText(result: unknown): string {
  const r = result as { content?: Array<{ text?: string }> };
  return r.content?.[0]?.text ?? "";
}

describe("registerBuildLinkedInUrl", () => {
  beforeEach(async () => {
    // `resetAllMocks`, not `clearAllMocks`: this file carries a file-wide
    // module mock, and `clear` keeps implementations -- including an unconsumed
    // `mockImplementationOnce`, which would then leak into the next test.
    // `reset` drains that queue but also wipes the delegation the mock factory
    // installed, so the baseline is re-established here rather than assumed.
    vi.resetAllMocks();
    const actual =
      await vi.importActual<typeof import("@lhremote/core")>("@lhremote/core");
    vi.mocked(core.buildLinkedInUrl).mockImplementation(actual.buildLinkedInUrl);
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

  /**
   * `mcpError` declares `text: string`, and this value leaves the process as
   * the tool's wire payload -- an agent is what reads it.  Unlike the other
   * sites in this change, the un-coerced value is observable here rather than
   * absorbed by an interpolation, so the type is asserted alongside the text.
   */
  it("hands a non-string message to the wire as a string", async () => {
    const { server, getHandler } = createMockServer();
    registerBuildLinkedInUrl(server);
    vi.mocked(buildLinkedInUrl).mockImplementationOnce(() => {
      throw errorWithMessage(42);
    });

    const handler = getHandler("build-linkedin-url");
    const result = await handler({
      sourceType: "SearchPage",
      keywords: "engineer",
    });

    const payload = result as {
      isError?: boolean;
      content: { text: unknown }[];
    };
    const [entry] = payload.content;
    expect(payload.isError).toBe(true);
    expect(entry).toBeDefined();
    expect(typeof entry?.text).toBe("string");
    expect(entry?.text).toBe("42");
  });
});
