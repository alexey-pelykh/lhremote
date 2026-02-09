import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    getActionTypeCatalog: vi.fn(),
    getActionTypeInfo: vi.fn(),
  };
});

import {
  type ActionTypeCatalog,
  type ActionTypeInfo,
  getActionTypeCatalog,
  getActionTypeInfo,
} from "@lhremote/core";

import { registerDescribeActions } from "./describe-actions.js";
import { createMockServer } from "./testing/mock-server.js";

const mockedGetActionTypeCatalog = vi.mocked(getActionTypeCatalog);
const mockedGetActionTypeInfo = vi.mocked(getActionTypeInfo);

describe("registerDescribeActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named describe-actions", () => {
    const { server } = createMockServer();
    registerDescribeActions(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "describe-actions",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns full catalog when no params", async () => {
    const { server, getHandler } = createMockServer();
    registerDescribeActions(server);

    const catalog: ActionTypeCatalog = {
      actionTypes: [
        {
          name: "VisitAndExtract",
          description: "Visit a LinkedIn profile and extract data.",
          category: "people",
          configSchema: {},
        },
        {
          name: "Follow",
          description: "Follow a LinkedIn profile.",
          category: "engagement",
          configSchema: {},
        },
      ],
    };

    mockedGetActionTypeCatalog.mockReturnValue(catalog);

    const handler = getHandler("describe-actions");
    const result = (await handler({ category: "all" })) as {
      content: [{ text: string }];
    };

    expect(mockedGetActionTypeCatalog).toHaveBeenCalledWith(undefined);
    expect(JSON.parse(result.content[0].text)).toEqual(catalog);
  });

  it("filters by category", async () => {
    const { server, getHandler } = createMockServer();
    registerDescribeActions(server);

    const catalog: ActionTypeCatalog = {
      actionTypes: [
        {
          name: "Follow",
          description: "Follow a LinkedIn profile.",
          category: "engagement",
          configSchema: {},
        },
      ],
    };

    mockedGetActionTypeCatalog.mockReturnValue(catalog);

    const handler = getHandler("describe-actions");
    const result = (await handler({ category: "engagement" })) as {
      content: [{ text: string }];
    };

    expect(mockedGetActionTypeCatalog).toHaveBeenCalledWith("engagement");
    expect(JSON.parse(result.content[0].text)).toEqual(catalog);
  });

  it("returns specific action type info", async () => {
    const { server, getHandler } = createMockServer();
    registerDescribeActions(server);

    const info: ActionTypeInfo = {
      name: "VisitAndExtract",
      description: "Visit a LinkedIn profile and extract data.",
      category: "people",
      configSchema: {
        extractProfile: {
          type: "boolean",
          required: false,
          description: "Whether to extract full profile data.",
          default: true,
        },
      },
      example: { extractProfile: true },
    };

    mockedGetActionTypeInfo.mockReturnValue(info);

    const handler = getHandler("describe-actions");
    const result = (await handler({
      category: "all",
      actionType: "VisitAndExtract",
    })) as {
      content: [{ text: string }];
    };

    expect(mockedGetActionTypeInfo).toHaveBeenCalledWith("VisitAndExtract");
    expect(JSON.parse(result.content[0].text)).toEqual(info);
  });

  it("returns error for unknown action type", async () => {
    const { server, getHandler } = createMockServer();
    registerDescribeActions(server);

    mockedGetActionTypeInfo.mockReturnValue(undefined as never);

    const handler = getHandler("describe-actions");
    const result = await handler({
      category: "all",
      actionType: "NonExistent",
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Unknown action type: NonExistent",
        },
      ],
    });
  });
});
