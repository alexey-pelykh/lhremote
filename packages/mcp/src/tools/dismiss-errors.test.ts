// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    dismissErrors: vi.fn(),
  };
});

import { type DismissErrorsOutput, dismissErrors } from "@lhremote/core";

import { registerDismissErrors } from "./dismiss-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const mockedDismissErrors = vi.mocked(dismissErrors);

describe("registerDismissErrors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named dismiss-errors", () => {
    const { server } = createMockServer();
    registerDismissErrors(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "dismiss-errors",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns result as JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerDismissErrors(server);

    const output: DismissErrorsOutput = {
      accountId: 1,
      dismissed: 2,
      nonDismissable: 0,
    };

    mockedDismissErrors.mockResolvedValue(output);

    const handler = getHandler("dismiss-errors");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    expect(JSON.parse(result.content[0].text)).toEqual(output);
  });

  it("returns error when dismissErrors throws", async () => {
    const { server, getHandler } = createMockServer();
    registerDismissErrors(server);

    mockedDismissErrors.mockRejectedValue(new Error("unexpected failure"));

    const handler = getHandler("dismiss-errors");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to dismiss errors: unexpected failure",
        },
      ],
    });
  });

  it("passes cdpPort to dismissErrors", async () => {
    const { server, getHandler } = createMockServer();
    registerDismissErrors(server);

    mockedDismissErrors.mockResolvedValue({
      accountId: 1,
      dismissed: 0,
      nonDismissable: 0,
    });

    const handler = getHandler("dismiss-errors");
    await handler({ cdpPort: 4567 });

    expect(mockedDismissErrors).toHaveBeenCalledWith({
      cdpPort: 4567,
      cdpHost: undefined,
      allowRemote: undefined,
    });
  });
});
