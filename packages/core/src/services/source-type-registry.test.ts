// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import { detectSourceType, validateSourceType } from "./source-type-registry.js";

describe("detectSourceType", () => {
  describe("Free tier", () => {
    it("should detect SearchPage from people search URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/search/results/people/?keywords=engineer"),
      ).toBe("SearchPage");
    });

    it("should detect MyConnections from connections URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/mynetwork/invite-connect/connections/"),
      ).toBe("MyConnections");
    });

    it("should detect Alumni from school people URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/school/stanford-university/people/"),
      ).toBe("Alumni");
    });

    it("should detect OrganizationPeople from company people URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/company/google/people/"),
      ).toBe("OrganizationPeople");
    });

    it("should detect Group from group members URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/groups/12345/members/"),
      ).toBe("Group");
    });

    it("should detect Event from event attendees URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/events/67890/attendees/"),
      ).toBe("Event");
    });

    it("should detect LWVYPP from profile views URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/me/profile-views/"),
      ).toBe("LWVYPP");
    });

    it("should detect SentInvitationPage from sent invitations URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/mynetwork/invitation-manager/sent/"),
      ).toBe("SentInvitationPage");
    });

    it("should detect FollowersPage from followers URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/me/my-network/followers/"),
      ).toBe("FollowersPage");
    });

    it("should detect FollowingPage from following URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/me/my-network/following/"),
      ).toBe("FollowingPage");
    });
  });

  describe("Sales Navigator tier", () => {
    it("should detect SNSearchPage from Sales Navigator people search URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/sales/search/people?query=test"),
      ).toBe("SNSearchPage");
    });

    it("should detect SNListPage from Sales Navigator people list URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/sales/lists/people/12345"),
      ).toBe("SNListPage");
    });

    it("should detect SNOrgsPage from Sales Navigator company search URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/sales/search/company?query=test"),
      ).toBe("SNOrgsPage");
    });

    it("should detect SNOrgsListsPage from Sales Navigator company list URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/sales/lists/company/12345"),
      ).toBe("SNOrgsListsPage");
    });
  });

  describe("Recruiter tier", () => {
    it("should detect TSearchPage from Talent search URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/talent/search/?query=test"),
      ).toBe("TSearchPage");
    });

    it("should detect TProjectPage from Talent projects URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/talent/projects/12345"),
      ).toBe("TProjectPage");
    });

    it("should detect RSearchPage from Recruiter search URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/recruiter/search/?query=test"),
      ).toBe("RSearchPage");
    });

    it("should detect RProjectPage from Recruiter projects URL", () => {
      expect(
        detectSourceType("https://www.linkedin.com/recruiter/projects/12345"),
      ).toBe("RProjectPage");
    });
  });

  describe("edge cases", () => {
    it("should return undefined for unknown URLs", () => {
      expect(detectSourceType("https://www.linkedin.com/in/some-user")).toBeUndefined();
    });

    it("should return undefined for non-LinkedIn URLs", () => {
      expect(detectSourceType("https://www.google.com/search?q=test")).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      expect(detectSourceType("")).toBeUndefined();
    });

    it("should handle URLs with query parameters", () => {
      expect(
        detectSourceType(
          "https://www.linkedin.com/search/results/people/?keywords=test&origin=GLOBAL",
        ),
      ).toBe("SearchPage");
    });

    it("should handle URLs with hash fragments", () => {
      expect(
        detectSourceType("https://www.linkedin.com/search/results/people/#section"),
      ).toBe("SearchPage");
    });

    it("should handle raw pathnames without hostname", () => {
      expect(detectSourceType("/search/results/people/")).toBe("SearchPage");
    });
  });
});

describe("validateSourceType", () => {
  it("should return true for all valid source types", () => {
    const validTypes = [
      "SearchPage",
      "MyConnections",
      "Alumni",
      "OrganizationPeople",
      "Group",
      "Event",
      "LWVYPP",
      "SentInvitationPage",
      "FollowersPage",
      "FollowingPage",
      "SNSearchPage",
      "SNListPage",
      "SNOrgsPage",
      "SNOrgsListsPage",
      "TSearchPage",
      "TProjectPage",
      "RSearchPage",
      "RProjectPage",
    ];

    for (const type of validTypes) {
      expect(validateSourceType(type)).toBe(true);
    }
  });

  it("should return false for unknown type strings", () => {
    expect(validateSourceType("InvalidType")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(validateSourceType("")).toBe(false);
  });

  it("should be case-sensitive", () => {
    expect(validateSourceType("searchpage")).toBe(false);
    expect(validateSourceType("SEARCHPAGE")).toBe(false);
  });
});
