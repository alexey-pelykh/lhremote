// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("../utils/delay.js", () => ({
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./get-feed.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import {
  extractPostUrn,
  getPostStats,
} from "./get-post-stats.js";

describe("extractPostUrn", () => {
  it("extracts URN from /feed/update/ URL with activity URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL with ugcPost URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678/",
      ),
    ).toBe("urn:li:ugcPost:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL with share URN", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678/",
      ),
    ).toBe("urn:li:share:7123456789012345678");
  });

  it("extracts URN from /feed/update/ URL without trailing slash", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("extracts activity URN from /posts/ URL", () => {
    expect(
      extractPostUrn(
        "https://www.linkedin.com/posts/johndoe_activity-7123456789012345678-abcd/",
      ),
    ).toBe("urn:li:activity:7123456789012345678");
  });

  it("passes through raw URN input", () => {
    expect(extractPostUrn("urn:li:activity:7123456789012345678")).toBe(
      "urn:li:activity:7123456789012345678",
    );
  });

  it("passes through raw ugcPost URN", () => {
    expect(extractPostUrn("urn:li:ugcPost:7123456789012345678")).toBe(
      "urn:li:ugcPost:7123456789012345678",
    );
  });

  it("throws on unrecognised input", () => {
    expect(() => extractPostUrn("https://example.com/foo")).toThrow(
      "Cannot extract post URN from",
    );
  });

  it("throws on empty input", () => {
    expect(() => extractPostUrn("")).toThrow("Cannot extract post URN from");
  });
});

describe("getPostStats", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  function setupMocks(opts?: {
    postStats?: unknown;
    readySequence?: boolean[];
  }) {
    const {
      postStats = { reactionCount: 42, commentCount: 5, shareCount: 3 },
      readySequence = [true],
    } = opts ?? {};

    vi.mocked(discoverTargets).mockResolvedValue([
      {
        id: "target-1",
        type: "page",
        title: "LinkedIn",
        url: "https://www.linkedin.com/feed/",
        description: "",
        devtoolsFrontendUrl: "",
      },
    ]);

    const disconnect = vi.fn();
    const navigate = vi.fn().mockResolvedValue(undefined);

    // Build evaluate mock call sequence:
    // 1. readiness checks (boolean)
    // 2. post stats scrape (object)
    const evaluateMock = vi.fn();
    for (const ready of readySequence) {
      evaluateMock.mockResolvedValueOnce(ready);
    }
    evaluateMock.mockResolvedValueOnce(postStats);

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate,
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as CDPClient;
    });

    return { evaluateMock, disconnect, navigate };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      getPostStats({
        postUrl: POST_URL,
        cdpPort: CDP_PORT,
        cdpHost: "192.168.1.1",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow("No LinkedIn page found in LinkedHelper");
  });

  it("navigates to post detail URL and extracts stats from DOM", async () => {
    const { navigate } = setupMocks();

    const result = await getPostStats({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/",
    );

    expect(result.stats).toEqual({
      postUrn: "urn:li:activity:1234567890",
      reactionCount: 42,
      reactionsByType: [],
      commentCount: 5,
      shareCount: 3,
    });
  });

  it("returns empty reactionsByType (DOM has no breakdown)", async () => {
    setupMocks({
      postStats: { reactionCount: 100, commentCount: 10, shareCount: 5 },
    });

    const result = await getPostStats({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.stats.reactionsByType).toEqual([]);
    expect(result.stats.reactionCount).toBe(100);
  });

  it("handles zero counts gracefully", async () => {
    setupMocks({
      postStats: { reactionCount: 0, commentCount: 0, shareCount: 0 },
    });

    const result = await getPostStats({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.stats).toEqual({
      postUrn: "urn:li:activity:1234567890",
      reactionCount: 0,
      reactionsByType: [],
      commentCount: 0,
      shareCount: 0,
    });
  });

  it("throws when DOM extraction returns null", async () => {
    setupMocks({ postStats: null });

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow("Failed to extract post stats from the DOM");
  });

  it("waits for post to load with polling", async () => {
    const { evaluateMock } = setupMocks({
      readySequence: [false, false, true],
    });

    await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    // 3 readiness checks + 1 stats scrape = 4
    expect(evaluateMock).toHaveBeenCalledTimes(4);
  });

  it("disconnects CDP client after successful operation", async () => {
    const { disconnect } = setupMocks();

    await getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
    const { disconnect } = setupMocks({ postStats: null });

    await expect(
      getPostStats({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    expect(disconnect).toHaveBeenCalled();
  });
});
