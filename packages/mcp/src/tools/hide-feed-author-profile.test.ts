// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return { ...actual, hideFeedAuthorProfile: vi.fn() };
});

import { hideFeedAuthorProfile } from "@insoftex/lhremote-core";

import { registerHideFeedAuthorProfile } from "./hide-feed-author-profile.js";
import { describeAccountIdForwarding } from "./testing/account-id-forwarding.js";

describe("registerHideFeedAuthorProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describeAccountIdForwarding({
    registerTool: registerHideFeedAuthorProfile,
    toolName: "hide-feed-author-profile",
    mock: vi.mocked(hideFeedAuthorProfile),
    baseArgs: { profileUrl: "https://www.linkedin.com/in/alice/" },
  });
});
