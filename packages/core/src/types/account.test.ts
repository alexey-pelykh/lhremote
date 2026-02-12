// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { describe, expect, it } from "vitest";
import type { Account } from "./account.js";

describe("Account type", () => {
  it("should allow constructing a full Account", () => {
    const account: Account = {
      id: 1,
      liId: 363386,
      name: "Test Account",
      email: "test@example.com",
    };

    expect(account.id).toBe(1);
    expect(account.liId).toBe(363386);
    expect(account.name).toBe("Test Account");
    expect(account.email).toBe("test@example.com");
  });

  it("should allow Account without optional email", () => {
    const account: Account = {
      id: 2,
      liId: 100000,
      name: "No Email",
    };

    expect(account.email).toBeUndefined();
  });
});
