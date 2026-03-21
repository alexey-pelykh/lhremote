// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    visitProfile: vi.fn(),
  };
});

import {
  type Profile,
  AccountResolutionError,
  visitProfile,
} from "@lhremote/core";

import { registerVisitProfile } from "./visit-profile.js";
import { describeInfrastructureErrors } from "./testing/infrastructure-errors.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_PROFILE: Profile = {
  id: 100,
  miniProfile: {
    firstName: "Jane",
    lastName: "Doe",
    headline: "Software Engineer",
    avatar: null,
  },
  externalIds: [{ externalId: "jane-doe-123", typeGroup: "public", isMemberId: false }],
  currentPosition: { company: "Acme Corp", title: "Senior Engineer" },
  education: [],
  skills: [{ name: "TypeScript" }],
  emails: [],
};

describe("registerVisitProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named visit-profile", () => {
    const { server } = createMockServer();
    registerVisitProfile(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "visit-profile",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns profile on success with personId", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitProfile(server);

    vi.mocked(visitProfile).mockResolvedValue({
      success: true,
      actionType: "VisitAndExtract",
      profile: MOCK_PROFILE,
    });

    const handler = getHandler("visit-profile");
    const result = await handler({ personId: 100, cdpPort: 9222 });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              actionType: "VisitAndExtract",
              profile: MOCK_PROFILE,
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("returns profile on success with url", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitProfile(server);

    vi.mocked(visitProfile).mockResolvedValue({
      success: true,
      actionType: "VisitAndExtract",
      profile: MOCK_PROFILE,
    });

    const handler = getHandler("visit-profile");
    const result = await handler({ url: "https://www.linkedin.com/in/jane-doe-123", cdpPort: 9222 });

    expect(visitProfile).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://www.linkedin.com/in/jane-doe-123", cdpPort: 9222 }),
    );
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: expect.any(String),
        },
      ],
    });
  });

  it("returns error when neither personId nor url provided", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitProfile(server);

    const handler = getHandler("visit-profile");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Exactly one of personId or url must be provided." }],
    });
    expect(visitProfile).not.toHaveBeenCalled();
  });

  it("returns error when both personId and url provided", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitProfile(server);

    const handler = getHandler("visit-profile");
    const result = await handler({ personId: 100, url: "https://www.linkedin.com/in/jane-doe", cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Exactly one of personId or url must be provided." }],
    });
    expect(visitProfile).not.toHaveBeenCalled();
  });

  it("passes correct arguments to operation", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitProfile(server);

    vi.mocked(visitProfile).mockResolvedValue({
      success: true,
      actionType: "VisitAndExtract",
      profile: MOCK_PROFILE,
    });

    const handler = getHandler("visit-profile");
    await handler({ personId: 100, extractCurrentOrganizations: true, cdpPort: 9222 });

    expect(visitProfile).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 100, extractCurrentOrganizations: true, cdpPort: 9222 }),
    );
  });

  it("returns error when no accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitProfile(server);

    vi.mocked(visitProfile).mockRejectedValue(
      new AccountResolutionError("no-accounts"),
    );

    const handler = getHandler("visit-profile");
    const result = await handler({ personId: 100, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "No accounts found." }],
    });
  });

  it("returns error when multiple accounts found", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitProfile(server);

    vi.mocked(visitProfile).mockRejectedValue(
      new AccountResolutionError("multiple-accounts"),
    );

    const handler = getHandler("visit-profile");
    const result = await handler({ personId: 100, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Multiple accounts found. Cannot determine which instance to use.",
        },
      ],
    });
  });

  it("returns error on unexpected failure", async () => {
    const { server, getHandler } = createMockServer();
    registerVisitProfile(server);

    vi.mocked(visitProfile).mockRejectedValue(
      new Error("action timed out"),
    );

    const handler = getHandler("visit-profile");
    const result = await handler({ personId: 100, cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to visit profile: action timed out",
        },
      ],
    });
  });

  describeInfrastructureErrors(
    registerVisitProfile,
    "visit-profile",
    () => ({ personId: 100, cdpPort: 9222 }),
    (error) => vi.mocked(visitProfile).mockRejectedValue(error),
    "Failed to visit profile",
  );
});
