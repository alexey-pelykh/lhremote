// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, dismissFeedPost: vi.fn() };
});

import { dismissFeedPost } from "@lhremote/core";

import { registerDismissFeedPost } from "./dismiss-feed-post.js";
import { describeAccountIdForwarding } from "./testing/account-id-forwarding.js";

describe("registerDismissFeedPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describeAccountIdForwarding({
    registerTool: registerDismissFeedPost,
    toolName: "dismiss-feed-post",
    mock: vi.mocked(dismissFeedPost),
    baseArgs: { feedIndex: 0 },
  });
});
