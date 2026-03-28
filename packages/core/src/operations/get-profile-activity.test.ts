// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractProfileId } from "./get-profile-activity.js";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./get-feed.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./get-feed.js")>();
  return {
    ...actual,
    delay: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  randomDelay: vi.fn().mockResolvedValue(undefined),
  randomBetween: vi.fn().mockReturnValue(800),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
}));

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { getProfileActivity } from "./get-profile-activity.js";
import type { RawDomPost } from "./get-feed.js";

const CDP_PORT = 9222;

function rawPost(overrides: Partial<RawDomPost> = {}): RawDomPost {
  return {
    url: null,
    authorName: "Jane Doe",
    authorHeadline: "Engineer at Acme",
    authorProfileUrl: "https://www.linkedin.com/in/janedoe",
    text: "Hello world from my profile",
    mediaType: null,
    reactionCount: 5,
    commentCount: 2,
    shareCount: 1,
    timestamp: "2h",
    ...overrides,
  };
}

/** Build a LinkedIn feed URL from a URN for test fixtures. */
function urnToUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

function setupMocks(scrapedPosts: RawDomPost[] = [], urlResults: (string | null)[] = []) {
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
  const navigate = vi.fn().mockResolvedValue({ frameId: "F1" });
  let urlCallIdx = 0;
  const evaluate = vi.fn().mockImplementation((script: string) => {
    // waitForActivityLoad poll — return true (ready)
    if (typeof script === "string" && script.includes("div[role=\"article\"]") && script.includes("return true")) {
      return Promise.resolve(true);
    }
    // Clipboard interceptor install
    if (typeof script === "string" && script.includes("navigator.clipboard.writeText")) {
      return Promise.resolve(undefined);
    }
    // Clipboard reset
    if (typeof script === "string" && script.includes("__capturedClipboard = null")) {
      return Promise.resolve(undefined);
    }
    // "Copy link to post" menu item click
    if (typeof script === "string" && script.includes("Copy link to post")) {
      return Promise.resolve(undefined);
    }
    // Read captured clipboard URL (exact match — not the reset)
    if (script === "window.__capturedClipboard") {
      const url = urlResults[urlCallIdx++] ?? null;
      return Promise.resolve(url);
    }
    // captureActivityPostUrl — click phase (split from scroll)
    if (typeof script === "string" && script.includes("btn.click()")) {
      return Promise.resolve(true);
    }
    // humanizedScrollToByIndex fallback — scrollIntoView
    if (typeof script === "string" && script.includes("scrollIntoView")) {
      return Promise.resolve(undefined);
    }
    // SCRAPE_ACTIVITY_POSTS_SCRIPT — return posts
    return Promise.resolve(scrapedPosts);
  });
  const send = vi.fn().mockResolvedValue(undefined);

  vi.mocked(CDPClient).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      navigate,
      evaluate,
      send,
    } as unknown as CDPClient;
  });

  return { navigate, disconnect, evaluate, send };
}

describe("extractProfileId", () => {
  it("extracts public ID from full profile URL", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/johndoe"),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with trailing slash", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/johndoe/"),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with query params", () => {
    expect(
      extractProfileId(
        "https://www.linkedin.com/in/johndoe?miniProfileUrn=urn",
      ),
    ).toBe("johndoe");
  });

  it("extracts public ID from profile URL with hash", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/johndoe#section"),
    ).toBe("johndoe");
  });

  it("decodes URL-encoded public ID", () => {
    expect(
      extractProfileId("https://www.linkedin.com/in/john%20doe"),
    ).toBe("john doe");
  });

  it("passes through bare public ID", () => {
    expect(extractProfileId("johndoe")).toBe("johndoe");
  });

  it("passes through bare public ID with hyphens", () => {
    expect(extractProfileId("john-doe-123")).toBe("john-doe-123");
  });

  it("throws on unrecognised URL", () => {
    expect(() => extractProfileId("https://example.com/foo")).toThrow(
      "Cannot extract profile ID from",
    );
  });

  it("throws on empty input", () => {
    expect(() => extractProfileId("")).toThrow(
      "Cannot extract profile ID from",
    );
  });
});

describe("getProfileActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("navigates to the profile recent-activity page", async () => {
    const { navigate } = setupMocks([]);

    await getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/johndoe/recent-activity/all/",
    );
  });

  it("URL-encodes the profile public ID in the navigation URL", async () => {
    const { navigate } = setupMocks([]);

    await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "https://www.linkedin.com/in/john%20doe",
    });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/john%20doe/recent-activity/all/",
    );
  });

  it("extracts profile ID from URL input for navigation", async () => {
    const { navigate } = setupMocks([]);

    await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "https://www.linkedin.com/in/janedoe",
    });

    expect(navigate).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/janedoe/recent-activity/all/",
    );
  });

  it("scrapes posts from the DOM", async () => {
    const posts = [rawPost()];
    const { evaluate } = setupMocks(posts);

    await getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" });

    expect(evaluate).toHaveBeenCalled();
  });

  it("extracts URLs via three-dot menu for each post", async () => {
    const posts = [rawPost(), rawPost({ authorName: "Bob" })];
    setupMocks(posts, [urnToUrl("urn:li:share:111"), urnToUrl("urn:li:share:222")]);

    const result = await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "johndoe",
    });

    expect(result.posts[0]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:share:111/");
    expect(result.posts[1]?.url).toBe("https://www.linkedin.com/feed/update/urn:li:share:222/");
  });

  it("returns posts with profilePublicId and nextCursor", async () => {
    const posts = [rawPost()];
    setupMocks(posts, [urnToUrl("urn:li:share:111")]);

    const result = await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "janedoe",
    });

    expect(result.profilePublicId).toBe("janedoe");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.authorName).toBe("Jane Doe");
    expect(result.posts[0]?.reactionCount).toBe(5);
    expect(result.nextCursor).toBeNull();
  });

  it("returns nextCursor when more posts available", async () => {
    const posts = Array.from({ length: 15 }, (_, i) =>
      rawPost({ authorName: `User ${String(i)}` }),
    );
    const urls = posts.map((_, i) => urnToUrl(`urn:li:share:${String(i)}`));
    setupMocks(posts, urls);

    const result = await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "johndoe",
      count: 10,
    });

    expect(result.posts).toHaveLength(10);
    expect(result.nextCursor).toBe("https://www.linkedin.com/feed/update/urn:li:share:9/");
  });

  it("uses cursor to skip past already-seen posts", async () => {
    const posts = Array.from({ length: 15 }, (_, i) =>
      rawPost({ authorName: `User ${String(i)}` }),
    );
    const urls = posts.map((_, i) => urnToUrl(`urn:li:share:${String(i)}`));
    setupMocks(posts, urls);

    const result = await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "johndoe",
      count: 5,
      cursor: "https://www.linkedin.com/feed/update/urn:li:share:4/",
    });

    expect(result.posts).toHaveLength(5);
    expect(result.posts[0]?.authorName).toBe("User 5");
  });

  it("builds post URLs from extracted URNs", async () => {
    setupMocks([rawPost()], [urnToUrl("urn:li:share:999")]);

    const result = await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "johndoe",
    });

    expect(result.posts[0]?.url).toBe(
      "https://www.linkedin.com/feed/update/urn:li:share:999/",
    );
  });

  it("handles posts where URL extraction fails", async () => {
    setupMocks([rawPost()], [null]);

    const result = await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "johndoe",
    });

    expect(result.posts[0]?.url).toBe("");
  });

  it("throws when no LinkedIn page found", async () => {
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(
      getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" }),
    ).rejects.toThrow("No LinkedIn page found in LinkedHelper");
  });

  it("throws on non-loopback host without allowRemote", async () => {
    await expect(
      getProfileActivity({
        cdpPort: CDP_PORT,
        profile: "johndoe",
        cdpHost: "192.168.1.1",
      }),
    ).rejects.toThrow("requires --allow-remote");
  });

  it("disconnects CDP client after operation", async () => {
    const { disconnect } = setupMocks([]);

    await getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" });

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
        navigate: vi.fn().mockRejectedValue(new Error("Navigation failed")),
        evaluate: vi.fn().mockResolvedValue(true),
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as CDPClient;
    });

    await expect(
      getProfileActivity({ cdpPort: CDP_PORT, profile: "johndoe" }),
    ).rejects.toThrow("Navigation failed");

    expect(disconnect).toHaveBeenCalled();
  });

  it("returns empty posts array when no activity found", async () => {
    setupMocks([]);

    const result = await getProfileActivity({
      cdpPort: CDP_PORT,
      profile: "johndoe",
    });

    expect(result.posts).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });
});
