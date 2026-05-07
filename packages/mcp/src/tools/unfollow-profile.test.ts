// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, unfollowProfile: vi.fn() };
});

import { unfollowProfile } from "@lhremote/core";

import { registerUnfollowProfile } from "./unfollow-profile.js";
import { describeAccountIdForwarding } from "./testing/account-id-forwarding.js";

describe("registerUnfollowProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describeAccountIdForwarding({
    registerTool: registerUnfollowProfile,
    toolName: "unfollow-profile",
    mock: vi.mocked(unfollowProfile),
    baseArgs: { profileUrl: "https://www.linkedin.com/in/alice/" },
  });
});
