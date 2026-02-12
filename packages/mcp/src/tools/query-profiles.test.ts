// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

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
  DatabaseClient,
  ProfileRepository,
  discoverAllDatabases,
} from "@lhremote/core";

import { registerQueryProfiles } from "./query-profiles.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_SEARCH_RESULT: ProfileSearchResult = {
  profiles: [
    {
      id: 1,
      firstName: "Jane",
      lastName: "Doe",
      headline: "Engineering Manager",
      company: "Acme Corp",
      title: "Engineering Manager",
    },
    {
      id: 2,
      firstName: "John",
      lastName: "Smith",
      headline: "Software Engineer",
      company: "Tech Inc",
      title: "Senior Engineer",
    },
  ],
  total: 150,
};

function mockDb() {
  const close = vi.fn();
  vi.mocked(DatabaseClient).mockImplementation(function () {
    return { close, db: {} } as unknown as DatabaseClient;
  });
  return { close };
}

function mockRepo(result: ProfileSearchResult = MOCK_SEARCH_RESULT) {
  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      search: vi.fn().mockReturnValue(result),
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

describe("registerQueryProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named query-profiles", () => {
    const { server } = createMockServer();
    registerQueryProfiles(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "query-profiles",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns search results as JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfiles(server);
    setupSuccessPath();

    const handler = getHandler("query-profiles");
    const result = await handler({});

    const response = JSON.parse(
      (result as { content: [{ text: string }] }).content[0].text,
    );
    expect(response.profiles).toHaveLength(2);
    expect(response.total).toBe(150);
    expect(response.limit).toBe(20);
    expect(response.offset).toBe(0);
  });

  it("passes search parameters to repository", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfiles(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    mockDb();

    const searchFn = vi.fn().mockReturnValue({ profiles: [], total: 0 });
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return { search: searchFn } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profiles");
    await handler({ query: "Jane", company: "Acme", limit: 10, offset: 5 });

    expect(searchFn).toHaveBeenCalledWith({
      query: "Jane",
      company: "Acme",
      limit: 10,
      offset: 5,
    });
  });

  it("returns error when no databases found", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfiles(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(new Map());

    const handler = getHandler("query-profiles");
    const result = await handler({});

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

  it("closes database after search", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfiles(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    const { close } = mockDb();
    mockRepo();

    const handler = getHandler("query-profiles");
    await handler({});

    expect(close).toHaveBeenCalledOnce();
  });

  it("returns error on database failure", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfiles(server);
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, "/path/to/db"]]),
    );
    mockDb();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        search: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profiles");
    const result = await handler({});

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

  it("aggregates results from multiple databases", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfiles(server);
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
          search: vi.fn().mockReturnValue({
            profiles: [{ id: 1, firstName: "Jane" }],
            total: 10,
          }),
        } as unknown as ProfileRepository;
      }
      return {
        search: vi.fn().mockReturnValue({
          profiles: [{ id: 2, firstName: "John" }],
          total: 20,
        }),
      } as unknown as ProfileRepository;
    });

    const handler = getHandler("query-profiles");
    const result = await handler({});

    const response = JSON.parse(
      (result as { content: [{ text: string }] }).content[0].text,
    );
    expect(response.profiles).toHaveLength(2);
    expect(response.total).toBe(30);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("returns custom limit and offset in response", async () => {
    const { server, getHandler } = createMockServer();
    registerQueryProfiles(server);
    setupSuccessPath();

    const handler = getHandler("query-profiles");
    const result = await handler({ limit: 50, offset: 100 });

    const response = JSON.parse(
      (result as { content: [{ text: string }] }).content[0].text,
    );
    expect(response.limit).toBe(50);
    expect(response.offset).toBe(100);
  });
});
