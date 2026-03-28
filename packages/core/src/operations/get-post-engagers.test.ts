// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./get-feed.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  randomDelay: vi.fn().mockResolvedValue(undefined),
  randomBetween: vi.fn().mockReturnValue(500),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../linkedin/dom-automation.js", () => ({
  humanizedScrollTo: vi.fn().mockResolvedValue(undefined),
  humanizedClick: vi.fn().mockResolvedValue(undefined),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { getPostEngagers } from "./get-post-engagers.js";

const DEFAULT_ENGAGERS = [
  {
    firstName: "Jane",
    lastName: "Doe",
    publicId: "janedoe",
    headline: "Software Engineer at ACME",
    engagementType: "LIKE",
  },
  {
    firstName: "John",
    lastName: "Smith",
    publicId: "johnsmith",
    headline: "Product Manager",
    engagementType: "PRAISE",
  },
];

describe("getPostEngagers", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  /**
   * Set up CDP mocks for the standard flow:
   *
   * 1. waitForPostLoad readiness polls (boolean[])
   * 2. FIND_REACTIONS_SCRIPT (boolean) — scroll + click are via dom-automation mocks
   * 3. waitForReactionsModal readiness polls (boolean[])
   * 4. GET_MODAL_TOTAL_SCRIPT (number)
   * 5. SCRAPE_ENGAGERS_SCRIPT + SCROLL_MODAL_SCRIPT interleaved
   */
  function setupMocks(opts?: {
    postReadySequence?: boolean[];
    reactionsFound?: boolean;
    modalReadySequence?: boolean[];
    totalReactions?: number;
    scrapeSequence?: (unknown[] | null)[];
    scrollSequence?: boolean[];
  }) {
    const {
      postReadySequence = [true],
      reactionsFound = true,
      modalReadySequence = [true],
      totalReactions = 2,
      scrapeSequence = [DEFAULT_ENGAGERS],
      scrollSequence = [],
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

    const evaluateMock = vi.fn();

    // 1. Post readiness polls
    for (const ready of postReadySequence) {
      evaluateMock.mockResolvedValueOnce(ready);
    }

    // 2. Find reactions element (scroll + click handled by dom-automation mocks)
    evaluateMock.mockResolvedValueOnce(reactionsFound);

    if (reactionsFound) {
      // 3. Modal readiness polls
      for (const ready of modalReadySequence) {
        evaluateMock.mockResolvedValueOnce(ready);
      }

      // 4. Total reactions
      evaluateMock.mockResolvedValueOnce(totalReactions);

      // 5. Scrape + scroll interleaved
      for (let i = 0; i < scrapeSequence.length; i++) {
        evaluateMock.mockResolvedValueOnce(scrapeSequence[i]);
        if (i < scrollSequence.length) {
          evaluateMock.mockResolvedValueOnce(scrollSequence[i]);
        }
      }
    }

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
      getPostEngagers({
        postUrl: POST_URL,
        cdpPort: CDP_PORT,
        cdpHost: "192.168.1.1",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow("No LinkedIn page found in LinkedHelper");
  });

  it("navigates to post detail URL and extracts engagers from DOM", async () => {
    const { navigate } = setupMocks();

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/",
    );

    expect(result.postUrn).toBe("urn:li:activity:1234567890");
    expect(result.engagers).toHaveLength(2);
    expect(result.engagers[0]).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
      publicId: "janedoe",
      headline: "Software Engineer at ACME",
      engagementType: "LIKE",
    });
    expect(result.engagers[1]).toMatchObject({
      firstName: "John",
      lastName: "Smith",
      publicId: "johnsmith",
      headline: "Product Manager",
      engagementType: "PRAISE",
    });
  });

  it("returns empty engagers when no reactions button found", async () => {
    setupMocks({ reactionsFound: false });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toEqual([]);
    expect(result.paging).toEqual({ start: 0, count: 0, total: 0 });
  });

  it("returns paging metadata from modal total", async () => {
    setupMocks({ totalReactions: 42 });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.paging).toEqual({ start: 0, count: 2, total: 42 });
  });

  it("handles empty engagers gracefully", async () => {
    setupMocks({
      scrapeSequence: [[]],
      totalReactions: 0,
    });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toEqual([]);
    expect(result.paging.count).toBe(0);
  });

  it("handles null evaluate result for engagers", async () => {
    setupMocks({ scrapeSequence: [null] });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toEqual([]);
  });

  it("scrolls modal for pagination", async () => {
    const first = DEFAULT_ENGAGERS[0] as (typeof DEFAULT_ENGAGERS)[0];
    const partial = [first];
    const full = [...DEFAULT_ENGAGERS];

    setupMocks({
      totalReactions: 2,
      scrapeSequence: [partial, full],
      scrollSequence: [true],
    });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      count: 2,
    });

    expect(result.engagers).toHaveLength(2);
  });

  it("stops scrolling when modal is at bottom", async () => {
    const partial = [DEFAULT_ENGAGERS[0] as (typeof DEFAULT_ENGAGERS)[0]];

    setupMocks({
      totalReactions: 5,
      scrapeSequence: [partial, partial],
      scrollSequence: [true, false],
    });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      count: 5,
    });

    // Only got 1 engager despite requesting 5
    expect(result.engagers).toHaveLength(1);
  });

  it("respects count limit", async () => {
    const many = [
      ...DEFAULT_ENGAGERS,
      {
        firstName: "Alice",
        lastName: "Wonder",
        publicId: "alice",
        headline: "Designer",
        engagementType: "LIKE",
      },
    ];

    setupMocks({
      totalReactions: 3,
      scrapeSequence: [many],
    });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      count: 2,
    });

    expect(result.engagers).toHaveLength(2);
    expect(result.paging.count).toBe(2);
  });

  it("respects start offset", async () => {
    setupMocks({ totalReactions: 2 });

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
      start: 1,
      count: 10,
    });

    expect(result.engagers).toHaveLength(1);
    const engager = result.engagers[0] as (typeof result.engagers)[0];
    expect(engager.firstName).toBe("John");
    expect(result.paging.start).toBe(1);
  });

  it("waits for post to load with polling", async () => {
    const { evaluateMock } = setupMocks({
      postReadySequence: [false, false, true],
    });

    await getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT, count: 2 });

    // 3 readiness + 1 click + 1 modal ready + 1 total + 1 scrape = 7
    expect(evaluateMock).toHaveBeenCalledTimes(7);
  });

  it("waits for modal to load with polling", async () => {
    const { evaluateMock } = setupMocks({
      modalReadySequence: [false, true],
    });

    await getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT, count: 2 });

    // 1 readiness + 1 click + 2 modal ready + 1 total + 1 scrape = 6
    expect(evaluateMock).toHaveBeenCalledTimes(6);
  });

  it("disconnects CDP client after successful operation", async () => {
    const { disconnect } = setupMocks();

    await getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT });

    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
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
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect,
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockRejectedValue(new Error("evaluate failed")),
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as CDPClient;
    });

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    expect(disconnect).toHaveBeenCalled();
  });
});
