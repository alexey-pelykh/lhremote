// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

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
  ProfileRepository,
  discoverAllDatabases,
} from "@lhremote/core";

import { registerQueryProfilesBulk } from "./query-profiles-bulk.js";
import { createMockServer } from "./testing/mock-server.js";

const PROFILE_JANE: Profile = {
  id: 1,
  miniProfile: {
    firstName: "Jane",
    lastName: "Doe",
    headline: "Engineering Manager",
    avatar: null,
  },
  externalIds: [
    { externalId: "jane-doe-12345", typeGroup: "public", isMemberId: false },
  ],
  currentPosition: { company: "Acme Corp", title: "Engineering Manager" },
  education: [],
  skills: [],
  emails: [],
};

const PROFILE_BOB: Profile = {
  id: 2,
  miniProfile: {
    firstName: "Bob",
    lastName: "Smith",
    headline: "Developer",
    avatar: null,
  },
  externalIds: [
    { externalId: "bob-smith-67890", typeGroup: "public", isMemberId: false },
  ],
  currentPosition: { company: "Beta Inc", title: "Developer" },
  education: [],
  skills: [],
  emails: [],
};

const PROFILE_JANE_WITH_POSITIONS: Profile = {
  ...PROFILE_JANE,
  positions: [
    {
      company: "Acme Corp",
      title: "Engineering Manager",
      startDate: "2020-01",
      endDate: null,
      isCurrent: true,
    },
  ],
};

function mockDb() {
  const close = vi.fn();
  vi.mocked(DatabaseClient).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

function setupSuccessPath() {
  vi.mocked(discoverAllDatabases).mockReturnValue(
    new Map([[1, "/path/to/db"]]),
  );
  mockDb();
  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      findByIds: vi.fn().mockImplementation((ids: number[]) =>
        ids.map((id) => {
          if (id === 1) return PROFILE_JANE;
          if (id === 2) return PROFILE_BOB;
          return null;
        }),
      ),
      findByPublicIds: vi.fn().mockImplementation((slugs: string[]) =>
        slugs.map((s) => {
          if (s === "jane-doe-12345") return PROFILE_JANE;
          if (s === "bob-smith-67890") return PROFILE_BOB;
          return null;
        }),
      ),
    } as unknown as ProfileRepository;
  });
}

describe("registerQueryProfilesBulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named query-profiles-bulk", () => {
    const { server } = createMockServer();
    registerQueryProfilesBulk(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "query-profiles-bulk",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns profiles by personIds", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
    setupSuccessPath();

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({ personIds: [1, 2] });

    const content = (result as { content: Array<{ text: string }> }).content;
    const parsed = JSON.parse(content[0]?.text ?? "{}");
    expect(parsed.byPersonId).toHaveLength(2);
    expect(parsed.byPersonId[0].id).toBe(1);
    expect(parsed.byPersonId[1].id).toBe(2);
  });

  it("returns profiles by publicIds", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
    setupSuccessPath();

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({
      publicIds: ["jane-doe-12345", "bob-smith-67890"],
    });

    const content = (result as { content: Array<{ text: string }> }).content;
    const parsed = JSON.parse(content[0]?.text ?? "{}");
    expect(parsed.byPublicId).toHaveLength(2);
    expect(parsed.byPublicId[0].id).toBe(1);
    expect(parsed.byPublicId[1].id).toBe(2);
  });

  it("returns both personIds and publicIds when both provided", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
    setupSuccessPath();

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({
      personIds: [1],
      publicIds: ["bob-smith-67890"],
    });

    const content = (result as { content: Array<{ text: string }> }).content;
    const parsed = JSON.parse(content[0]?.text ?? "{}");
    expect(parsed.byPersonId).toHaveLength(1);
    expect(parsed.byPersonId[0].id).toBe(1);
    expect(parsed.byPublicId).toHaveLength(1);
    expect(parsed.byPublicId[0].id).toBe(2);
  });

  it("returns null for IDs not found", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
    setupSuccessPath();

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({ personIds: [1, 999] });

    const content = (result as { content: Array<{ text: string }> }).content;
    const parsed = JSON.parse(content[0]?.text ?? "{}");
    expect(parsed.byPersonId).toHaveLength(2);
    expect(parsed.byPersonId[0].id).toBe(1);
    expect(parsed.byPersonId[1]).toBeNull();
  });

  it("passes includePositions to repository", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    mockDb();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        findByIds: vi.fn().mockImplementation((_ids: number[], options?: { includePositions?: boolean }) =>
          options?.includePositions ? [PROFILE_JANE_WITH_POSITIONS] : [PROFILE_JANE],
        ),
        findByPublicIds: vi.fn().mockReturnValue([]),
      } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({
      personIds: [1],
      includePositions: true,
    });

    const content = (result as { content: Array<{ text: string }> }).content;
    const parsed = JSON.parse(content[0]?.text ?? "{}");
    expect(parsed.byPersonId[0].positions).toHaveLength(1);
  });

  it("returns error when neither personIds nor publicIds provided", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({});

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "At least one of personIds or publicIds must be provided with at least one element.",
        },
      ],
    });
  });

  it("returns error when both arrays are empty", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({ personIds: [], publicIds: [] });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "At least one of personIds or publicIds must be provided with at least one element.",
        },
      ],
    });
  });

  it("returns error when no databases found", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(new Map());

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({ personIds: [1] });

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

  it("searches multiple databases and aggregates results", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
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
        // First DB has Jane but not Bob
        return {
          findByIds: vi.fn().mockImplementation((ids: number[]) =>
            ids.map((id) => (id === 1 ? PROFILE_JANE : null)),
          ),
          findByPublicIds: vi.fn().mockReturnValue([]),
        } as unknown as ProfileRepository;
      }
      // Second DB has Bob
      return {
        findByIds: vi.fn().mockImplementation((ids: number[]) =>
          ids.map((id) => (id === 2 ? PROFILE_BOB : null)),
        ),
        findByPublicIds: vi.fn().mockReturnValue([]),
      } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({ personIds: [1, 2] });

    const content = (result as { content: Array<{ text: string }> }).content;
    const parsed = JSON.parse(content[0]?.text ?? "{}");
    expect(parsed.byPersonId).toHaveLength(2);
    expect(parsed.byPersonId[0].id).toBe(1);
    expect(parsed.byPersonId[1].id).toBe(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("skips already-found IDs in subsequent databases", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([
        [1, "/path/to/db1"],
        [2, "/path/to/db2"],
      ]),
    );

    mockDb();

    const findByIdsSpy1 = vi.fn().mockReturnValue([PROFILE_JANE]);
    const findByIdsSpy2 = vi.fn().mockReturnValue([]);

    let callCount = 0;
    vi.mocked(ProfileRepository).mockImplementation(function () {
      callCount++;
      return {
        findByIds: callCount === 1 ? findByIdsSpy1 : findByIdsSpy2,
        findByPublicIds: vi.fn().mockReturnValue([]),
      } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profiles-bulk");
    await handler({ personIds: [1] });

    // First DB should be called with [1]
    expect(findByIdsSpy1).toHaveBeenCalledWith([1], { includePositions: false });
    // Second DB should NOT be called since profile 1 was already found
    expect(findByIdsSpy2).not.toHaveBeenCalled();
  });

  it("closes database after successful lookup", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    const { close } = mockDb();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        findByIds: vi.fn().mockReturnValue([PROFILE_JANE]),
        findByPublicIds: vi.fn().mockReturnValue([]),
      } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profiles-bulk");
    await handler({ personIds: [1] });

    expect(close).toHaveBeenCalledOnce();
  });

  it("returns error on unexpected database failure", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfilesBulk(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    mockDb();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        findByIds: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profiles-bulk");
    const result = await handler({ personIds: [1] });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to query profiles: database locked",
        },
      ],
    });
  });
});
