// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { describe, expect, it } from "vitest";
import { isLoopbackAddress } from "./loopback.js";

describe("isLoopbackAddress", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.2",
    "127.255.255.255",
    "localhost",
    "localhost.",
    "LOCALHOST",
    "Localhost",
    "::1",
    "[::1]",
    "0:0:0:0:0:0:0:1",
    "[0:0:0:0:0:0:0:1]",
  ])("returns true for loopback address %s", (host) => {
    expect(isLoopbackAddress(host)).toBe(true);
  });

  it.each([
    "192.168.1.1",
    "10.0.0.1",
    "0.0.0.0",
    "example.com",
    "::2",
    "128.0.0.1",
    "",
    "local",
  ])("returns false for non-loopback address %s", (host) => {
    expect(isLoopbackAddress(host)).toBe(false);
  });
});
