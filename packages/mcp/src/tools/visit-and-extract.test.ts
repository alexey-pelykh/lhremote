import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    InstanceService: vi.fn(),
    DatabaseClient: vi.fn(),
    ProfileService: vi.fn(),
    discoverInstancePort: vi.fn(),
    discoverDatabase: vi.fn(),
  };
});

import {
  type Account,
  type Profile,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  ExtractionTimeoutError,
  InstanceNotRunningError,
  InstanceService,
  LauncherService,
  LinkedHelperNotRunningError,
  ProfileService,
} from "@lhremote/core";

import { registerVisitAndExtract } from "./visit-and-extract.js";
import { createMockServer } from "./testing/mock-server.js";

const PROFILE_URL = "https://www.linkedin.com/in/john-doe";

const MOCK_PROFILE: Profile = {
  id: 1,
  miniProfile: {
    firstName: "John",
    lastName: "Doe",
    headline: "Engineer",
    avatar: null,
  },
  externalIds: [],
  currentPosition: { company: "Acme", title: "Engineer" },
  positions: [
    {
      company: "Acme",
      title: "Engineer",
      startDate: "2020-01",
      endDate: null,
      isCurrent: true,
    },
  ],
  education: [],
  skills: [{ name: "TypeScript" }],
  emails: ["john@example.com"],
};

function mockLauncher(overrides: Record<string, unknown> = {}) {
  const disconnect = vi.fn();
  vi.mocked(LauncherService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ id: 1, liId: 1, name: "Alice" } as Account]),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

function mockInstance(overrides: Record<string, unknown> = {}) {
  const disconnect = vi.fn();
  vi.mocked(InstanceService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      ...overrides,
    } as unknown as InstanceService;
  });
  return { disconnect };
}

function mockDb() {
  const close = vi.fn();
  vi.mocked(DatabaseClient).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

function mockProfileService(profile: Profile = MOCK_PROFILE) {
  vi.mocked(ProfileService).mockImplementation(function () {
    return {
      visitAndExtract: vi.fn().mockResolvedValue(profile),
    } as unknown as ProfileService;
  });
}

function setupSuccessPath() {
  mockLauncher();
  mockInstance();
  mockDb();
  mockProfileService();
  vi.mocked(discoverInstancePort).mockResolvedValue(55123);
  vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
}

describe("registerVisitAndExtract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named visit-and-extract", () => {
    const { server } = createMockServer();
    registerVisitAndExtract(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "visit-and-extract",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns extracted profile as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);
    setupSuccessPath();

    const handler = getHandler("visit-and-extract");
    const result = await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_PROFILE, null, 2),
        },
      ],
    });
  });

  it("returns error for invalid LinkedIn URL", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    const handler = getHandler("visit-and-extract");
    const result = await handler({
      profileUrl: "https://example.com/not-linkedin",
      cdpPort: 9222,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Invalid LinkedIn profile URL. Expected: https://www.linkedin.com/in/username",
        },
      ],
    });
  });

  it("returns error when LinkedHelper not running", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("visit-and-extract");
    const result = await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "LinkedHelper is not running. Use launch-app first.",
        },
      ],
    });
  });

  it("returns error when launcher connect fails with unknown error", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("visit-and-extract");
    const result = await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to connect to LinkedHelper: connection refused",
        },
      ],
    });
  });

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    const handler = getHandler("visit-and-extract");
    const result = await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "No accounts found." }],
    });
  });

  it("returns error when multiple accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 1, name: "Alice" },
        { id: 2, liId: 2, name: "Bob" },
      ]),
    });

    const handler = getHandler("visit-and-extract");
    const result = await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Multiple accounts found. Cannot determine which instance to use.",
        },
      ],
    });
  });

  it("returns error when no instance is running", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    const handler = getHandler("visit-and-extract");
    const result = await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No LinkedHelper instance is running. Use start-instance first.",
        },
      ],
    });
  });

  it("returns error when instance connect fails", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(InstanceService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(
            new InstanceNotRunningError("LinkedIn webview target not found"),
          ),
        disconnect: vi.fn(),
      } as unknown as InstanceService;
    });

    const handler = getHandler("visit-and-extract");
    const result = await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No LinkedHelper instance is running. Use start-instance first.",
        },
      ],
    });
  });

  it("returns error on extraction timeout", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(ProfileService).mockImplementation(function () {
      return {
        visitAndExtract: vi
          .fn()
          .mockRejectedValue(
            new ExtractionTimeoutError(PROFILE_URL, 30000),
          ),
      } as unknown as ProfileService;
    });

    const handler = getHandler("visit-and-extract");
    const result = await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Profile extraction timed out. The profile may not have loaded correctly.",
        },
      ],
    });
  });

  it("returns error on unexpected extraction failure", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(ProfileService).mockImplementation(function () {
      return {
        visitAndExtract: vi
          .fn()
          .mockRejectedValue(new Error("database locked")),
      } as unknown as ProfileService;
    });

    const handler = getHandler("visit-and-extract");
    const result = await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to extract profile: database locked",
        },
      ],
    });
  });

  it("disconnects launcher after account lookup", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    const { disconnect: launcherDisconnect } = mockLauncher();
    mockInstance();
    mockDb();
    mockProfileService();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("visit-and-extract");
    await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(launcherDisconnect).toHaveBeenCalledOnce();
  });

  it("disconnects instance and closes db after success", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    mockProfileService();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    const handler = getHandler("visit-and-extract");
    await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("disconnects instance and closes db after error", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(ProfileService).mockImplementation(function () {
      return {
        visitAndExtract: vi
          .fn()
          .mockRejectedValue(new Error("test error")),
      } as unknown as ProfileService;
    });

    const handler = getHandler("visit-and-extract");
    await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("passes cdpPort to LauncherService and discoverInstancePort", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    setupSuccessPath();

    const handler = getHandler("visit-and-extract");
    await handler({ profileUrl: PROFILE_URL, cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567);
    expect(discoverInstancePort).toHaveBeenCalledWith(4567);
  });

  it("passes discovered port to InstanceService", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    setupSuccessPath();

    const handler = getHandler("visit-and-extract");
    await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(InstanceService).toHaveBeenCalledWith(55123);
  });

  it("discovers database for the account", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    setupSuccessPath();

    const handler = getHandler("visit-and-extract");
    await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(discoverDatabase).toHaveBeenCalledWith(1);
  });

  it("passes profileUrl to ProfileService.visitAndExtract", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    const mockVisitAndExtract = vi.fn().mockResolvedValue(MOCK_PROFILE);
    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(ProfileService).mockImplementation(function () {
      return {
        visitAndExtract: mockVisitAndExtract,
      } as unknown as ProfileService;
    });

    const handler = getHandler("visit-and-extract");
    await handler({ profileUrl: PROFILE_URL, cdpPort: 9222 });

    expect(mockVisitAndExtract).toHaveBeenCalledWith(PROFILE_URL, {});
  });

  it("passes timeout to ProfileService.visitAndExtract as pollTimeout", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitAndExtract(server);

    const mockVisitAndExtract = vi.fn().mockResolvedValue(MOCK_PROFILE);
    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(ProfileService).mockImplementation(function () {
      return {
        visitAndExtract: mockVisitAndExtract,
      } as unknown as ProfileService;
    });

    const handler = getHandler("visit-and-extract");
    await handler({ profileUrl: PROFILE_URL, cdpPort: 9222, timeout: 60000 });

    expect(mockVisitAndExtract).toHaveBeenCalledWith(PROFILE_URL, {
      pollTimeout: 60000,
    });
  });
});
