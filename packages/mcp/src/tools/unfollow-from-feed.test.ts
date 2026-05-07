// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, unfollowFromFeed: vi.fn() };
});

import { unfollowFromFeed } from "@lhremote/core";

import { registerUnfollowFromFeed } from "./unfollow-from-feed.js";
import { describeAccountIdForwarding } from "./testing/account-id-forwarding.js";

describe("registerUnfollowFromFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describeAccountIdForwarding({
    registerTool: registerUnfollowFromFeed,
    toolName: "unfollow-from-feed",
    mock: vi.mocked(unfollowFromFeed),
    baseArgs: { feedIndex: 0 },
  });
});
