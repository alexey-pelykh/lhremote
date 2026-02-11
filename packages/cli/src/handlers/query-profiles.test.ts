import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    DatabaseClient: vi.fn(),
    ProfileRepository: vi.fn(),
    discoverAllDatabases: vi.fn(),
  };
});

import {
  type ProfileSearchResult,
  ProfileRepository,
} from "@lhremote/core";

import { handleQueryProfiles } from "./query-profiles.js";
import { mockDb, mockDiscovery } from "./testing/mock-helpers.js";

const MOCK_SEARCH_RESULT: ProfileSearchResult = {
  profiles: [
    {
      id: 12345,
      firstName: "Jane",
      lastName: "Doe",
      headline: "Engineering Manager at Acme",
      company: "Acme Corp",
      title: "Engineering Manager",
    },
    {
      id: 12346,
      firstName: "Jane",
      lastName: "Smith",
      headline: "Product Designer at DesignCo",
      company: "DesignCo",
      title: "Product Designer",
    },
  ],
  total: 12,
};

function mockRepo(result: ProfileSearchResult = MOCK_SEARCH_RESULT) {
  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      search: vi.fn().mockReturnValue(result),
    } as unknown as ProfileRepository;
  });
}

function setupSuccessPath() {
  mockDiscovery();
  mockDb();
  mockRepo();
}

describe("handleQueryProfiles", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("sets exitCode 1 when no databases found", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery(new Map());

    await handleQueryProfiles({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper databases found.\n",
    );
  });

  it("prints JSON with --json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfiles({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.profiles).toHaveLength(2);
    expect(parsed.total).toBe(12);
    expect(parsed.limit).toBe(20);
    expect(parsed.offset).toBe(0);
  });

  it("prints human-friendly output by default", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfiles({ query: "Jane" });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(
      'Profiles matching "Jane" (showing 2 of 12):\n\n',
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "#12345  Jane Doe — Engineering Manager at Acme Corp\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "#12346  Jane Smith — Product Designer at DesignCo\n",
    );
  });

  it("shows company filter in description", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfiles({ company: "Acme" });

    expect(stdoutSpy).toHaveBeenCalledWith(
      'Profiles matching company "Acme" (showing 2 of 12):\n\n',
    );
  });

  it("shows combined filters in description", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfiles({ query: "Jane", company: "Acme" });

    expect(stdoutSpy).toHaveBeenCalledWith(
      'Profiles matching "Jane", company "Acme" (showing 2 of 12):\n\n',
    );
  });

  it("shows 'all' when no filters specified", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfiles({});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Profiles matching all (showing 2 of 12):\n\n",
    );
  });

  it("prints 'No profiles found' when empty results", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    mockRepo({ profiles: [], total: 0 });

    await handleQueryProfiles({ query: "Nonexistent" });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(
      'No profiles found matching "Nonexistent".\n',
    );
  });

  it("falls back to headline when no position", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    mockRepo({
      profiles: [
        {
          id: 1,
          firstName: "Bob",
          lastName: null,
          headline: "Freelance Consultant",
          company: null,
          title: null,
        },
      ],
      total: 1,
    });

    await handleQueryProfiles({});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "#1  Bob — Freelance Consultant\n",
    );
  });

  it("closes database after search", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockDiscovery();
    const { close } = mockDb();
    mockRepo();

    await handleQueryProfiles({});

    expect(close).toHaveBeenCalledOnce();
  });

  it("sets exitCode 1 on unexpected database error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        search: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as ProfileRepository;
    });

    await handleQueryProfiles({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("database locked\n");
  });

  it("passes parameters to repository", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockDiscovery();
    mockDb();

    const searchFn = vi.fn().mockReturnValue({ profiles: [], total: 0 });
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return { search: searchFn } as unknown as ProfileRepository;
    });

    await handleQueryProfiles({
      query: "Jane",
      company: "Acme",
      limit: 10,
      offset: 5,
    });

    expect(searchFn).toHaveBeenCalledWith({
      query: "Jane",
      company: "Acme",
      limit: 10,
      offset: 5,
    });
  });

  it("uses custom limit and offset in JSON output", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfiles({ limit: 50, offset: 100, json: true });

    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(100);
  });
});
