// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    getErrors: vi.fn(),
  };
});

import { type GetErrorsOutput, getErrors } from "@lhremote/core";

import { registerGetErrors } from "./get-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const mockedGetErrors = vi.mocked(getErrors);

describe("registerGetErrors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named get-errors", () => {
    const { server } = createMockServer();
    registerGetErrors(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "get-errors",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns healthy status as JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerGetErrors(server);

    const output: GetErrorsOutput = {
      accountId: 1,
      healthy: true,
      issues: [],
      popup: null,
    };

    mockedGetErrors.mockResolvedValue(output);

    const handler = getHandler("get-errors");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    expect(JSON.parse(result.content[0].text)).toEqual(output);
  });

  it("returns blocked status with issues", async () => {
    const { server, getHandler } = createMockServer();
    registerGetErrors(server);

    const output: GetErrorsOutput = {
      accountId: 1,
      healthy: false,
      issues: [
        {
          type: "critical-error",
          id: "e1",
          data: { message: "Database unavailable" },
        },
      ],
      popup: null,
    };

    mockedGetErrors.mockResolvedValue(output);

    const handler = getHandler("get-errors");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    const parsed = JSON.parse(result.content[0].text) as GetErrorsOutput;
    expect(parsed.healthy).toBe(false);
    expect(parsed.issues).toHaveLength(1);
  });

  it("returns error when getErrors throws", async () => {
    const { server, getHandler } = createMockServer();
    registerGetErrors(server);

    mockedGetErrors.mockRejectedValue(new Error("unexpected failure"));

    const handler = getHandler("get-errors");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to get errors: unexpected failure",
        },
      ],
    });
  });

  it("passes cdpPort to getErrors", async () => {
    const { server, getHandler } = createMockServer();
    registerGetErrors(server);

    mockedGetErrors.mockResolvedValue({
      accountId: 1,
      healthy: true,
      issues: [],
      popup: null,
    });

    const handler = getHandler("get-errors");
    await handler({ cdpPort: 4567 });

    expect(mockedGetErrors).toHaveBeenCalledWith({
      cdpPort: 4567,
      cdpHost: undefined,
      allowRemote: undefined,
    });
  });
});
