// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { describe, expect, it } from "vitest";

import { escapeLike } from "./escape-like.js";

describe("escapeLike", () => {
  it("returns plain text unchanged", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });

  it("escapes percent wildcard", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("escapes underscore wildcard", () => {
    expect(escapeLike("field_name")).toBe("field\\_name");
  });

  it("escapes backslash (the escape character itself)", () => {
    expect(escapeLike("path\\to")).toBe("path\\\\to");
  });

  it("escapes multiple special characters", () => {
    expect(escapeLike("100% of_items\\done")).toBe(
      "100\\% of\\_items\\\\done",
    );
  });

  it("handles empty string", () => {
    expect(escapeLike("")).toBe("");
  });
});
