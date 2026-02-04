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
  InstanceService,
  LauncherService,
  ProfileService,
} from "@lhremote/core";

import { handleVisitAndExtract } from "./visit-and-extract.js";

const PROFILE_URL = "https://www.linkedin.com/in/john-doe";

const MOCK_PROFILE: Profile = {
  id: 1,
  miniProfile: {
    firstName: "John",
    lastName: "Doe",
    headline: "Software Engineer",
    avatar: null,
  },
  externalIds: [],
  currentPosition: { company: "Acme Corp", title: "Senior Engineer" },
  positions: [
    {
      company: "Acme Corp",
      title: "Senior Engineer",
      startDate: "2020-01",
      endDate: null,
      isCurrent: true,
    },
  ],
  education: [
    {
      school: "MIT",
      degree: "BS",
      field: "CS",
      startDate: "2014",
      endDate: "2018",
    },
  ],
  skills: [{ name: "TypeScript" }, { name: "Node.js" }],
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

function mockInstance() {
  const disconnect = vi.fn();
  vi.mocked(InstanceService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
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

describe("handleVisitAndExtract", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("sets exitCode 1 for invalid LinkedIn URL", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    await handleVisitAndExtract("https://example.com/not-linkedin", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Invalid LinkedIn profile URL. Expected: https://www.linkedin.com/in/username\n",
    );
  });

  it("prints JSON with --json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleVisitAndExtract(PROFILE_URL, { json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(JSON.parse(output)).toEqual(MOCK_PROFILE);
  });

  it("prints human-friendly output on success", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("John Doe\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Software Engineer\n");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Senior Engineer at Acme Corp\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith("Emails: john@example.com\n");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Skills: TypeScript, Node.js\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Positions: 1, Education: 1\n",
    );
  });

  it("handles profile with no headline or current position", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    const minimalProfile: Profile = {
      id: 2,
      miniProfile: {
        firstName: "Jane",
        lastName: null,
        headline: null,
        avatar: null,
      },
      externalIds: [],
      currentPosition: null,
      positions: [],
      education: [],
      skills: [],
      emails: [],
    };

    mockLauncher();
    mockInstance();
    mockDb();
    mockProfileService(minimalProfile);
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("Jane\n");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Positions: 0, Education: 0\n",
    );
    // Should not print headline, emails, skills lines
    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    expect(calls).not.toContainEqual(expect.stringContaining("Emails:"));
    expect(calls).not.toContainEqual(expect.stringContaining("Skills:"));
  });

  it("sets exitCode 1 when no accounts found", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([]),
    });

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No accounts found.\n");
  });

  it("sets exitCode 1 when multiple accounts found", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockLauncher({
      listAccounts: vi.fn().mockResolvedValue([
        { id: 1, liId: 1, name: "Alice" },
        { id: 2, liId: 2, name: "Bob" },
      ]),
    });

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Multiple accounts found. Cannot determine which instance to use.\n",
    );
  });

  it("sets exitCode 1 when launcher connection fails", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("connection refused\n");
  });

  it("sets exitCode 1 when no instance running", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockLauncher();
    vi.mocked(discoverInstancePort).mockResolvedValue(null);

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running. Use start-instance first.\n",
    );
  });

  it("sets exitCode 1 on extraction error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockLauncher();
    mockInstance();
    mockDb();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");
    vi.mocked(ProfileService).mockImplementation(function () {
      return {
        visitAndExtract: vi
          .fn()
          .mockRejectedValue(new Error("extraction failed")),
      } as unknown as ProfileService;
    });

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("extraction failed\n");
  });

  it("disconnects launcher after account lookup", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const { disconnect: launcherDisconnect } = mockLauncher();
    mockInstance();
    mockDb();
    mockProfileService();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(launcherDisconnect).toHaveBeenCalledOnce();
  });

  it("disconnects instance and closes db after success", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockLauncher();
    const { disconnect: instanceDisconnect } = mockInstance();
    const { close: dbClose } = mockDb();
    mockProfileService();
    vi.mocked(discoverInstancePort).mockResolvedValue(55123);
    vi.mocked(discoverDatabase).mockReturnValue("/path/to/db");

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(instanceDisconnect).toHaveBeenCalledOnce();
    expect(dbClose).toHaveBeenCalledOnce();
  });

  it("passes cdpPort option to launcher and discovery", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    setupSuccessPath();

    await handleVisitAndExtract(PROFILE_URL, { cdpPort: 4567 });

    expect(LauncherService).toHaveBeenCalledWith(4567);
    expect(discoverInstancePort).toHaveBeenCalledWith(4567);
  });

  it("uses default cdpPort 9222 when not specified", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    setupSuccessPath();

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(LauncherService).toHaveBeenCalledWith(9222);
    expect(discoverInstancePort).toHaveBeenCalledWith(9222);
  });

  it("passes pollTimeout to ProfileService.visitAndExtract", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

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

    await handleVisitAndExtract(PROFILE_URL, { pollTimeout: 60000 });

    expect(mockVisitAndExtract).toHaveBeenCalledWith(PROFILE_URL, {
      pollTimeout: 60000,
    });
  });

  it("does not pass pollTimeout when not specified", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

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

    await handleVisitAndExtract(PROFILE_URL, {});

    expect(mockVisitAndExtract).toHaveBeenCalledWith(PROFILE_URL, {});
  });
});
