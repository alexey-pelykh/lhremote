// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { detectSourceType } from "./source-type-registry.js";
import {
  buildParameterisedUrl,
  getFixedUrl,
  getParameterType,
  isFixedUrlType,
  isParameterisedType,
  isSNSearchBuilderType,
  isSearchBuilderType,
} from "./url-templates.js";

describe("isFixedUrlType", () => {
  it("returns true for fixed URL types", () => {
    expect(isFixedUrlType("MyConnections")).toBe(true);
    expect(isFixedUrlType("LWVYPP")).toBe(true);
    expect(isFixedUrlType("SentInvitationPage")).toBe(true);
    expect(isFixedUrlType("FollowersPage")).toBe(true);
    expect(isFixedUrlType("FollowingPage")).toBe(true);
    expect(isFixedUrlType("SNOrgsPage")).toBe(true);
    expect(isFixedUrlType("TSearchPage")).toBe(true);
    expect(isFixedUrlType("RSearchPage")).toBe(true);
  });

  it("returns false for non-fixed types", () => {
    expect(isFixedUrlType("SearchPage")).toBe(false);
    expect(isFixedUrlType("SNSearchPage")).toBe(false);
    expect(isFixedUrlType("OrganizationPeople")).toBe(false);
  });
});

describe("isParameterisedType", () => {
  it("returns true for parameterised types", () => {
    expect(isParameterisedType("OrganizationPeople")).toBe(true);
    expect(isParameterisedType("Alumni")).toBe(true);
    expect(isParameterisedType("Group")).toBe(true);
    expect(isParameterisedType("Event")).toBe(true);
    expect(isParameterisedType("SNListPage")).toBe(true);
    expect(isParameterisedType("SNOrgsListsPage")).toBe(true);
    expect(isParameterisedType("TProjectPage")).toBe(true);
    expect(isParameterisedType("RProjectPage")).toBe(true);
  });

  it("returns false for non-parameterised types", () => {
    expect(isParameterisedType("SearchPage")).toBe(false);
    expect(isParameterisedType("MyConnections")).toBe(false);
  });
});

describe("isSearchBuilderType", () => {
  it("returns true for SearchPage", () => {
    expect(isSearchBuilderType("SearchPage")).toBe(true);
  });

  it("returns false for other types", () => {
    expect(isSearchBuilderType("SNSearchPage")).toBe(false);
    expect(isSearchBuilderType("MyConnections")).toBe(false);
  });
});

describe("isSNSearchBuilderType", () => {
  it("returns true for SNSearchPage", () => {
    expect(isSNSearchBuilderType("SNSearchPage")).toBe(true);
  });

  it("returns false for other types", () => {
    expect(isSNSearchBuilderType("SearchPage")).toBe(false);
  });
});

describe("getFixedUrl", () => {
  it("returns correct URL for MyConnections", () => {
    const url = getFixedUrl("MyConnections");
    expect(url).toBe(
      "https://www.linkedin.com/mynetwork/invite-connect/connections/",
    );
    expect(detectSourceType(url ?? "")).toBe("MyConnections");
  });

  it("returns correct URL for LWVYPP", () => {
    const url = getFixedUrl("LWVYPP");
    expect(url).toBe("https://www.linkedin.com/me/profile-views/");
    expect(detectSourceType(url ?? "")).toBe("LWVYPP");
  });

  it("returns correct URL for SentInvitationPage", () => {
    const url = getFixedUrl("SentInvitationPage");
    expect(url).toBe(
      "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
    );
    expect(detectSourceType(url ?? "")).toBe("SentInvitationPage");
  });

  it("returns correct URL for FollowersPage", () => {
    const url = getFixedUrl("FollowersPage");
    expect(url).toBe("https://www.linkedin.com/me/my-network/followers/");
    expect(detectSourceType(url ?? "")).toBe("FollowersPage");
  });

  it("returns correct URL for FollowingPage", () => {
    const url = getFixedUrl("FollowingPage");
    expect(url).toBe("https://www.linkedin.com/me/my-network/following/");
    expect(detectSourceType(url ?? "")).toBe("FollowingPage");
  });

  it("returns undefined for non-fixed types", () => {
    expect(getFixedUrl("SearchPage")).toBeUndefined();
  });
});

describe("buildParameterisedUrl", () => {
  it("builds OrganizationPeople URL with slug", () => {
    const url = buildParameterisedUrl("OrganizationPeople", {
      slug: "google",
    });
    expect(url).toBe("https://www.linkedin.com/company/google/people/");
    expect(detectSourceType(url ?? "")).toBe("OrganizationPeople");
  });

  it("builds Alumni URL with slug", () => {
    const url = buildParameterisedUrl("Alumni", { slug: "stanford" });
    expect(url).toBe("https://www.linkedin.com/school/stanford/people/");
    expect(detectSourceType(url ?? "")).toBe("Alumni");
  });

  it("builds Group URL with id", () => {
    const url = buildParameterisedUrl("Group", { id: "12345" });
    expect(url).toBe("https://www.linkedin.com/groups/12345/members/");
    expect(detectSourceType(url ?? "")).toBe("Group");
  });

  it("builds Event URL with id", () => {
    const url = buildParameterisedUrl("Event", { id: "67890" });
    expect(url).toBe("https://www.linkedin.com/events/67890/attendees/");
    expect(detectSourceType(url ?? "")).toBe("Event");
  });

  it("builds SNListPage URL with id", () => {
    const url = buildParameterisedUrl("SNListPage", { id: "abc123" });
    expect(url).toBe("https://www.linkedin.com/sales/lists/people/abc123/");
    expect(detectSourceType(url ?? "")).toBe("SNListPage");
  });

  it("builds SNOrgsListsPage URL with id", () => {
    const url = buildParameterisedUrl("SNOrgsListsPage", { id: "xyz" });
    expect(url).toBe("https://www.linkedin.com/sales/lists/company/xyz/");
    expect(detectSourceType(url ?? "")).toBe("SNOrgsListsPage");
  });

  it("builds TProjectPage URL with id", () => {
    const url = buildParameterisedUrl("TProjectPage", { id: "proj1" });
    expect(url).toBe("https://www.linkedin.com/talent/projects/proj1/");
    expect(detectSourceType(url ?? "")).toBe("TProjectPage");
  });

  it("builds RProjectPage URL with id", () => {
    const url = buildParameterisedUrl("RProjectPage", { id: "proj2" });
    expect(url).toBe("https://www.linkedin.com/recruiter/projects/proj2/");
    expect(detectSourceType(url ?? "")).toBe("RProjectPage");
  });

  it("returns undefined when required param is missing", () => {
    expect(buildParameterisedUrl("OrganizationPeople", {})).toBeUndefined();
    expect(
      buildParameterisedUrl("OrganizationPeople", { id: "123" }),
    ).toBeUndefined();
    expect(buildParameterisedUrl("Group", { slug: "test" })).toBeUndefined();
  });

  it("encodes special characters in params", () => {
    const url = buildParameterisedUrl("OrganizationPeople", {
      slug: "my company",
    });
    expect(url).toContain("my%20company");
  });

  it("returns undefined for non-parameterised types", () => {
    expect(
      buildParameterisedUrl("MyConnections", { id: "123" }),
    ).toBeUndefined();
  });
});

describe("getParameterType", () => {
  it("returns slug for slug-based types", () => {
    expect(getParameterType("OrganizationPeople")).toBe("slug");
    expect(getParameterType("Alumni")).toBe("slug");
  });

  it("returns id for id-based types", () => {
    expect(getParameterType("Group")).toBe("id");
    expect(getParameterType("Event")).toBe("id");
    expect(getParameterType("SNListPage")).toBe("id");
  });

  it("returns undefined for non-parameterised types", () => {
    expect(getParameterType("SearchPage")).toBeUndefined();
    expect(getParameterType("MyConnections")).toBeUndefined();
  });
});
