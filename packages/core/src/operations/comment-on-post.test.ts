// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  ActionBudgetRepository: vi.fn(),
}));

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("../linkedin/dom-automation.js", () => ({
  waitForElement: vi.fn(),
  humanizedScrollTo: vi.fn(),
  click: vi.fn(),
  humanizedClick: vi.fn(),
  typeText: vi.fn(),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
}));

import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { ActionBudgetRepository } from "../db/index.js";
import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { waitForElement, humanizedScrollTo, humanizedClick, typeText } from "../linkedin/dom-automation.js";
import type { ActionBudgetEntry } from "../types/action-budget.js";
import { BudgetExceededError } from "../services/errors.js";
import { commentOnPost } from "./comment-on-post.js";

const MOCK_CDP_PORT = 9222;
const MOCK_POST_URL = "https://www.linkedin.com/feed/update/urn:li:activity:123/";

function createMockClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue({ frameId: "F1" }),
    waitForEvent: vi.fn().mockResolvedValue(undefined),
  };
}

function setupMocks(budgetEntries: ActionBudgetEntry[] = [
  {
    limitTypeId: 19,
    limitType: "PostComment",
    dailyLimit: 10,
    campaignUsed: 2,
    directUsed: 0,
    totalUsed: 2,
    remaining: 8,
  },
]) {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(ActionBudgetRepository).mockImplementation(function () {
    return {
      getActionBudget: vi.fn().mockReturnValue(budgetEntries),
      getLimitTypes: vi.fn().mockReturnValue([]),
    } as unknown as ActionBudgetRepository;
  });

  vi.mocked(discoverTargets).mockResolvedValue([
    { id: "T1", type: "page", title: "LinkedIn", url: "https://www.linkedin.com/feed/", description: "", devtoolsFrontendUrl: "" },
  ]);

  const mockClient = createMockClient();
  vi.mocked(CDPClient).mockImplementation(function () {
    return mockClient as unknown as CDPClient;
  });

  // Reset DOM automation mocks to default resolved state
  vi.mocked(waitForElement).mockResolvedValue(undefined);
  vi.mocked(humanizedScrollTo).mockResolvedValue(undefined);
  vi.mocked(humanizedClick).mockResolvedValue(undefined);
  vi.mocked(typeText).mockResolvedValue(undefined);

  return mockClient;
}

describe("commentOnPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects empty comment text", async () => {
    await expect(
      commentOnPost({ postUrl: MOCK_POST_URL, text: "", cdpPort: MOCK_CDP_PORT }),
    ).rejects.toThrow("Comment text cannot be empty");
  });

  it("rejects whitespace-only comment text", async () => {
    await expect(
      commentOnPost({ postUrl: MOCK_POST_URL, text: "   ", cdpPort: MOCK_CDP_PORT }),
    ).rejects.toThrow("Comment text cannot be empty");
  });

  it("rejects invalid LinkedIn post URL", async () => {
    await expect(
      commentOnPost({ postUrl: "https://example.com/foo", text: "hello", cdpPort: MOCK_CDP_PORT }),
    ).rejects.toThrow("Invalid LinkedIn post URL");
  });

  it("accepts /feed/update/ URL format", async () => {
    setupMocks();
    const result = await commentOnPost({
      postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:123456/",
      text: "hello",
      cdpPort: MOCK_CDP_PORT,
    });
    expect(result.success).toBe(true);
  });

  it("accepts /posts/ URL format", async () => {
    setupMocks();
    const result = await commentOnPost({
      postUrl: "https://www.linkedin.com/posts/johndoe_activity-123456-abcd/",
      text: "hello",
      cdpPort: MOCK_CDP_PORT,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-loopback host without allowRemote", async () => {
    await expect(
      commentOnPost({
        postUrl: MOCK_POST_URL,
        text: "hello",
        cdpPort: MOCK_CDP_PORT,
        cdpHost: "192.168.1.100",
      }),
    ).rejects.toThrow("Non-loopback CDP host");
  });

  it("allows non-loopback host with allowRemote", async () => {
    const mockClient = setupMocks();

    const result = await commentOnPost({
      postUrl: MOCK_POST_URL,
      text: "hello",
      cdpPort: MOCK_CDP_PORT,
      cdpHost: "192.168.1.100",
      allowRemote: true,
    });

    expect(result.success).toBe(true);
    expect(mockClient.connect).toHaveBeenCalled();
  });

  it("throws BudgetExceededError when PostComment limit reached", async () => {
    setupMocks([
      {
        limitTypeId: 19,
        limitType: "PostComment",
        dailyLimit: 10,
        campaignUsed: 10,
        directUsed: 0,
        totalUsed: 10,
        remaining: 0,
      },
    ]);

    await expect(
      commentOnPost({ postUrl: MOCK_POST_URL, text: "hello", cdpPort: MOCK_CDP_PORT }),
    ).rejects.toThrow(BudgetExceededError);
  });

  it("proceeds when PostComment has remaining budget", async () => {
    setupMocks();

    const result = await commentOnPost({
      postUrl: MOCK_POST_URL,
      text: "Great post!",
      cdpPort: MOCK_CDP_PORT,
    });

    expect(result.success).toBe(true);
    expect(result.postUrl).toBe(MOCK_POST_URL);
    expect(result.commentText).toBe("Great post!");
    expect(result.parentCommentUrn).toBeNull();
  });

  it("proceeds when PostComment has no daily limit (unlimited)", async () => {
    setupMocks([
      {
        limitTypeId: 19,
        limitType: "PostComment",
        dailyLimit: null,
        campaignUsed: 0,
        directUsed: 0,
        totalUsed: 0,
        remaining: null,
      },
    ]);

    const result = await commentOnPost({
      postUrl: MOCK_POST_URL,
      text: "hello",
      cdpPort: MOCK_CDP_PORT,
    });

    expect(result.success).toBe(true);
  });

  it("proceeds when PostComment limit type is not in budget", async () => {
    setupMocks([
      {
        limitTypeId: 8,
        limitType: "Invite",
        dailyLimit: 100,
        campaignUsed: 5,
        directUsed: 0,
        totalUsed: 5,
        remaining: 95,
      },
    ]);

    const result = await commentOnPost({
      postUrl: MOCK_POST_URL,
      text: "hello",
      cdpPort: MOCK_CDP_PORT,
    });

    expect(result.success).toBe(true);
  });

  it("throws when no LinkedIn page is found", async () => {
    setupMocks();
    vi.mocked(discoverTargets).mockResolvedValue([]);

    await expect(
      commentOnPost({ postUrl: MOCK_POST_URL, text: "hello", cdpPort: MOCK_CDP_PORT }),
    ).rejects.toThrow("No LinkedIn page found");
  });

  it("navigates to post URL and performs DOM automation", async () => {
    const mockClient = setupMocks();

    await commentOnPost({
      postUrl: MOCK_POST_URL,
      text: "Nice!",
      cdpPort: MOCK_CDP_PORT,
    });

    // Verify navigation
    expect(mockClient.send).toHaveBeenCalledWith("Page.enable");
    expect(mockClient.navigate).toHaveBeenCalledWith(MOCK_POST_URL);
    expect(mockClient.waitForEvent).toHaveBeenCalledWith("Page.loadEventFired");

    // Verify DOM automation sequence
    expect(waitForElement).toHaveBeenCalled();
    expect(humanizedScrollTo).toHaveBeenCalled();
    expect(humanizedClick).toHaveBeenCalledTimes(2); // comment input + submit
    expect(typeText).toHaveBeenCalled();
  });

  it("disconnects CDP client even on error", async () => {
    const mockClient = setupMocks();
    vi.mocked(waitForElement).mockRejectedValue(new Error("timeout"));

    await expect(
      commentOnPost({ postUrl: MOCK_POST_URL, text: "hello", cdpPort: MOCK_CDP_PORT }),
    ).rejects.toThrow("timeout");

    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await commentOnPost({
      postUrl: MOCK_POST_URL,
      text: "hello",
      cdpPort: 1234,
      cdpHost: "localhost",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "localhost",
      allowRemote: true,
    });
  });

  it("clicks Reply button when parentCommentUrn is provided", async () => {
    setupMocks();
    const parentUrn = "urn:li:comment:(activity:123,999)";

    const result = await commentOnPost({
      postUrl: MOCK_POST_URL,
      text: "Reply text",
      parentCommentUrn: parentUrn,
      cdpPort: MOCK_CDP_PORT,
    });

    expect(result.success).toBe(true);
    expect(result.parentCommentUrn).toBe(parentUrn);

    // Reply flow: waitForElement called for comment article, reply button, focused input, submit button
    expect(waitForElement).toHaveBeenCalledTimes(4);

    // First call: wait for the target comment article
    const firstSelector = vi.mocked(waitForElement).mock.calls[0]?.[1];
    expect(firstSelector).toContain(`article[data-id="${parentUrn}"]`);

    // Second call: wait for reply button within the article
    const secondSelector = vi.mocked(waitForElement).mock.calls[1]?.[1];
    expect(secondSelector).toContain('button[aria-label^="Reply to "]');

    // Third call: wait for focused comment input (not the global one)
    const thirdSelector = vi.mocked(waitForElement).mock.calls[2]?.[1];
    expect(thirdSelector).toContain(":focus");

    // scrollTo called for the comment article (not the top-level input)
    expect(humanizedScrollTo).toHaveBeenCalledTimes(1);
    const scrollSelector = vi.mocked(humanizedScrollTo).mock.calls[0]?.[1];
    expect(scrollSelector).toContain(`article[data-id="${parentUrn}"]`);
  });

  it("rejects invalid parentCommentUrn format", async () => {
    await expect(
      commentOnPost({
        postUrl: MOCK_POST_URL,
        text: "hello",
        parentCommentUrn: "not-a-valid-urn",
        cdpPort: MOCK_CDP_PORT,
      }),
    ).rejects.toThrow("Invalid comment URN");
  });

  it("returns parentCommentUrn as null for top-level comments", async () => {
    setupMocks();

    const result = await commentOnPost({
      postUrl: MOCK_POST_URL,
      text: "Top level",
      cdpPort: MOCK_CDP_PORT,
    });

    expect(result.parentCommentUrn).toBeNull();
  });
});
