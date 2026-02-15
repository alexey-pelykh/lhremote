// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import {
  DatabaseError,
  DatabaseNotFoundError,
  ProfileNotFoundError,
} from "./errors.js";

describe("DatabaseError", () => {
  it("is an instance of Error", () => {
    const err = new DatabaseError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DatabaseError");
  });
});

describe("DatabaseNotFoundError", () => {
  it("includes the account ID in the message", () => {
    const err = new DatabaseNotFoundError(42);
    expect(err.message).toBe("No database found for account 42");
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err.name).toBe("DatabaseNotFoundError");
  });
});

describe("ProfileNotFoundError", () => {
  it("formats numeric IDs", () => {
    const err = new ProfileNotFoundError(7);
    expect(err.message).toContain("id 7");
    expect(err.name).toBe("ProfileNotFoundError");
  });

  it("formats string public IDs", () => {
    const err = new ProfileNotFoundError("alice-smith");
    expect(err.message).toContain('public ID "alice-smith"');
  });

  it("extends DatabaseError", () => {
    expect(new ProfileNotFoundError(1)).toBeInstanceOf(DatabaseError);
  });
});
