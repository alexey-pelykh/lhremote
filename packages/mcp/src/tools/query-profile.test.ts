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
  type Profile,
  DatabaseClient,
  ProfileNotFoundError,
  ProfileRepository,
  discoverAllDatabases,
} from "@lhremote/core";

import { registerQueryProfile } from "./query-profile.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_PROFILE: Profile = {
  id: 1,
  miniProfile: {
    firstName: "Jane",
    lastName: "Doe",
    headline: "Engineering Manager",
    avatar: null,
  },
  externalIds: [
    { externalId: "jane-doe-12345", typeGroup: "public", isMemberId: false },
    { externalId: "987654321", typeGroup: "member", isMemberId: true },
  ],
  currentPosition: { company: "Acme Corp", title: "Engineering Manager" },
  positions: [
    {
      company: "Acme Corp",
      title: "Engineering Manager",
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
  skills: [{ name: "TypeScript" }, { name: "React" }],
  emails: ["jane@acme.com"],
};

function mockDb() {
  const close = vi.fn();
  vi.mocked(DatabaseClient).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

function mockRepo(profile: Profile = MOCK_PROFILE) {
  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      findById: vi.fn().mockReturnValue(profile),
      findByPublicId: vi.fn().mockReturnValue(profile),
    } as unknown as ProfileRepository;
  });
}

function mockRepoNotFound() {
  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      findById: vi.fn().mockImplementation((id: number) => {
        throw new ProfileNotFoundError(id);
      }),
      findByPublicId: vi.fn().mockImplementation((slug: string) => {
        throw new ProfileNotFoundError(slug);
      }),
    } as unknown as ProfileRepository;
  });
}

function setupSuccessPath() {
  vi.mocked(discoverAllDatabases).mockReturnValue(
    new Map([[1, "/path/to/db"]]),
  );
  mockDb();
  mockRepo();
}

describe("registerQueryProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named query-profile", () => {
    const { server } = createMockServer();
    registerQueryProfile(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "query-profile",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns profile as JSON when looking up by personId", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);
    setupSuccessPath();

    const handler = getHandler("query-profile");
    const result = await handler({ personId: 1 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_PROFILE, null, 2),
        },
      ],
    });
  });

  it("returns profile as JSON when looking up by publicId", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);
    setupSuccessPath();

    const handler = getHandler("query-profile");
    const result = await handler({ publicId: "jane-doe-12345" });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_PROFILE, null, 2),
        },
      ],
    });
  });

  it("returns error when neither personId nor publicId provided", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);

    const handler = getHandler("query-profile");
    const result = await handler({});

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Exactly one of personId or publicId must be provided.",
        },
      ],
    });
  });

  it("returns error when both personId and publicId provided", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);

    const handler = getHandler("query-profile");
    const result = await handler({ personId: 1, publicId: "jane-doe-12345" });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Exactly one of personId or publicId must be provided.",
        },
      ],
    });
  });

  it("returns error when no databases found", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(new Map());

    const handler = getHandler("query-profile");
    const result = await handler({ personId: 1 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "No LinkedHelper databases found.",
        },
      ],
    });
  });

  it("returns error when profile not found in any database", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    mockDb();
    mockRepoNotFound();

    const handler = getHandler("query-profile");
    const result = await handler({ personId: 999 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Profile not found.",
        },
      ],
    });
  });

  it("searches multiple databases until profile found", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([
        [1, "/path/to/db1"],
        [2, "/path/to/db2"],
      ]),
    );

    const close = vi.fn();
    vi.mocked(DatabaseClient).mockImplementation(function () {
      return { close, db: {} } as unknown as DatabaseClient;
    });

    let callCount = 0;
    vi.mocked(ProfileRepository).mockImplementation(function () {
      callCount++;
      if (callCount === 1) {
        return {
          findById: vi.fn().mockImplementation((id: number) => {
            throw new ProfileNotFoundError(id);
          }),
          findByPublicId: vi.fn().mockImplementation((slug: string) => {
            throw new ProfileNotFoundError(slug);
          }),
        } as unknown as ProfileRepository;
      }
      return {
        findById: vi.fn().mockReturnValue(MOCK_PROFILE),
        findByPublicId: vi.fn().mockReturnValue(MOCK_PROFILE),
      } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profile");
    const result = await handler({ personId: 1 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(MOCK_PROFILE, null, 2),
        },
      ],
    });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("closes database after successful lookup", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    const { close } = mockDb();
    mockRepo();

    const handler = getHandler("query-profile");
    await handler({ personId: 1 });

    expect(close).toHaveBeenCalledOnce();
  });

  it("closes database after failed lookup", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    const { close } = mockDb();
    mockRepoNotFound();

    const handler = getHandler("query-profile");
    await handler({ personId: 999 });

    expect(close).toHaveBeenCalledOnce();
  });

  it("returns error on unexpected database failure", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfile(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    mockDb();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        findById: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profile");
    const result = await handler({ personId: 1 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to query profile: database locked",
        },
      ],
    });
  });
});
