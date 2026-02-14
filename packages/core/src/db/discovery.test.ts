// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatabaseNotFoundError } from "./errors.js";
import { discoverAllDatabases, discoverDatabase } from "./discovery.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedHomedir = vi.mocked(homedir);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("discoverDatabase", () => {
  it("returns the database path when the file exists (darwin)", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    mockedHomedir.mockReturnValue("/Users/alice");
    mockedExistsSync.mockReturnValue(true);

    const result = discoverDatabase(42);

    expect(result).toBe(
      join(
        "/Users/alice/Library/Application Support/linked-helper",
        "Partitions",
        "linked-helper-account-42-main",
        "lh.db",
      ),
    );
  });

  it("returns the database path when the file exists (win32)", () => {
    vi.stubGlobal("process", {
      ...process,
      platform: "win32",
      env: { APPDATA: "C:\\Users\\alice\\AppData\\Roaming" },
    });
    mockedHomedir.mockReturnValue("C:\\Users\\alice");
    mockedExistsSync.mockReturnValue(true);

    const result = discoverDatabase(7);

    expect(result).toBe(
      join(
        "C:\\Users\\alice\\AppData\\Roaming",
        "linked-helper",
        "Partitions",
        "linked-helper-account-7-main",
        "lh.db",
      ),
    );
  });

  it("returns the database path when the file exists (linux)", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    mockedHomedir.mockReturnValue("/home/alice");
    mockedExistsSync.mockReturnValue(true);

    const result = discoverDatabase(100);

    expect(result).toBe(
      join(
        "/home/alice/.config/linked-helper",
        "Partitions",
        "linked-helper-account-100-main",
        "lh.db",
      ),
    );
  });

  it("throws DatabaseNotFoundError when the file does not exist", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    mockedHomedir.mockReturnValue("/Users/alice");
    mockedExistsSync.mockReturnValue(false);

    expect(() => discoverDatabase(99)).toThrow(DatabaseNotFoundError);
    expect(() => discoverDatabase(99)).toThrow("No database found for account 99");
  });
});

describe("discoverAllDatabases", () => {
  it("returns an empty map when the partitions directory does not exist", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    mockedHomedir.mockReturnValue("/Users/alice");
    mockedExistsSync.mockReturnValue(false);

    const result = discoverAllDatabases();

    expect(result.size).toBe(0);
  });

  it("discovers multiple account databases", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    mockedHomedir.mockReturnValue("/Users/alice");

    const baseDir = join(
      "/Users/alice",
      "Library",
      "Application Support",
      "linked-helper",
      "Partitions",
    );

    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === baseDir) return true;
      if (path === join(baseDir, "linked-helper-account-1-main", "lh.db"))
        return true;
      if (path === join(baseDir, "linked-helper-account-2-main", "lh.db"))
        return true;
      return false;
    });

    mockedReaddirSync.mockReturnValue([
      makeDirent("linked-helper-account-1-main", true),
      makeDirent("linked-helper-account-2-main", true),
      makeDirent("some-other-dir", true),
      makeDirent("not-a-directory.txt", false),
    ] as never);

    const result = discoverAllDatabases();

    expect(result.size).toBe(2);
    expect(result.get(1)).toBe(
      join(baseDir, "linked-helper-account-1-main", "lh.db"),
    );
    expect(result.get(2)).toBe(
      join(baseDir, "linked-helper-account-2-main", "lh.db"),
    );
  });

  it("skips partitions where the db file is missing", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    mockedHomedir.mockReturnValue("/Users/alice");

    const baseDir = join(
      "/Users/alice",
      "Library",
      "Application Support",
      "linked-helper",
      "Partitions",
    );

    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === baseDir) return true;
      // Account 1 has a db, account 2 does not
      if (path === join(baseDir, "linked-helper-account-1-main", "lh.db"))
        return true;
      return false;
    });

    mockedReaddirSync.mockReturnValue([
      makeDirent("linked-helper-account-1-main", true),
      makeDirent("linked-helper-account-2-main", true),
    ] as never);

    const result = discoverAllDatabases();

    expect(result.size).toBe(1);
    expect(result.has(2)).toBe(false);
  });
});

function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: "",
    path: "",
  };
}
