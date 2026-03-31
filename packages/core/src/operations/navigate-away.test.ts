// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPClient } from "../cdp/client.js";
import { navigateAwayIf } from "./navigate-away.js";

const mockClient = {
  evaluate: vi.fn(),
  navigate: vi.fn().mockResolvedValue(undefined),
};

describe("navigateAwayIf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("navigates away when pathname contains the prefix", async () => {
    mockClient.evaluate.mockResolvedValue("/in/some-profile/");

    await navigateAwayIf(mockClient as unknown as CDPClient, "/in/");

    expect(mockClient.navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/mynetwork/",
    );
  });

  it("does not navigate when pathname does not contain the prefix", async () => {
    mockClient.evaluate.mockResolvedValue("/feed/");

    await navigateAwayIf(mockClient as unknown as CDPClient, "/in/");

    expect(mockClient.navigate).not.toHaveBeenCalled();
  });

  it("evaluates location.pathname via CDP", async () => {
    mockClient.evaluate.mockResolvedValue("/feed/");

    await navigateAwayIf(mockClient as unknown as CDPClient, "/in/");

    expect(mockClient.evaluate).toHaveBeenCalledWith("location.pathname");
  });

  it("handles exact prefix match", async () => {
    mockClient.evaluate.mockResolvedValue("/mynetwork/");

    await navigateAwayIf(mockClient as unknown as CDPClient, "/mynetwork/");

    expect(mockClient.navigate).toHaveBeenCalled();
  });

  it("handles partial prefix match within longer path", async () => {
    mockClient.evaluate.mockResolvedValue("/in/john-doe/detail/experience/");

    await navigateAwayIf(mockClient as unknown as CDPClient, "/in/");

    expect(mockClient.navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/mynetwork/",
    );
  });

  it("propagates evaluate errors", async () => {
    mockClient.evaluate.mockRejectedValue(new Error("CDP disconnected"));

    await expect(
      navigateAwayIf(mockClient as unknown as CDPClient, "/in/"),
    ).rejects.toThrow("CDP disconnected");
  });

  it("propagates navigate errors", async () => {
    mockClient.evaluate.mockResolvedValue("/in/some-profile/");
    mockClient.navigate.mockRejectedValue(new Error("navigation failed"));

    await expect(
      navigateAwayIf(mockClient as unknown as CDPClient, "/in/"),
    ).rejects.toThrow("navigation failed");
  });
});
