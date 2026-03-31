// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, vi } from "vitest";
import { retryInteraction } from "./dom-automation.js";

// Speed up tests by mocking delay internals
vi.mock("../utils/delay.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/delay.js")>();
  return {
    ...actual,
    delay: vi.fn().mockResolvedValue(undefined),
    gaussianDelay: vi.fn().mockResolvedValue(undefined),
  };
});

describe("retryInteraction", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryInteraction(fn, 3);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and returns eventual success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("recovered");
    const result = await retryInteraction(fn, 3);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent"));
    await expect(retryInteraction(fn, 2)).rejects.toThrow("persistent");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("defaults to 2 max attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(retryInteraction(fn)).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns null without retrying when fn returns null", async () => {
    const fn = vi.fn().mockResolvedValue(null);
    const result = await retryInteraction(fn, 3);
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
