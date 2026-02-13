// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseClient } from "../client.js";
import { ProfileNotFoundError } from "../errors.js";
import { FIXTURE_PATH } from "../testing/open-fixture.js";
import { ProfileRepository } from "./profile.js";

describe("ProfileRepository (integration)", () => {
  let client: DatabaseClient;
  let repo: ProfileRepository;

  beforeAll(() => {
    client = new DatabaseClient(FIXTURE_PATH);
    repo = new ProfileRepository(client);
  });

  afterAll(() => {
    client.close();
  });

  describe("findById", () => {
    it("assembles a full profile from the real schema", () => {
      const profile = repo.findById(1);

      expect(profile.id).toBe(1);

      // Mini profile
      expect(profile.miniProfile.firstName).toBe("Ada");
      expect(profile.miniProfile.lastName).toBe("Lovelace");
      expect(profile.miniProfile.headline).toBe(
        "Principal Analytical Engine Programmer",
      );
      expect(profile.miniProfile.avatar).toBe(
        "https://example.test/avatars/ada.jpg",
      );

      // External IDs
      expect(profile.externalIds.length).toBeGreaterThanOrEqual(2);
      const publicId = profile.externalIds.find(
        (e) => e.typeGroup === "public",
      );
      expect(publicId?.externalId).toBe("ada-lovelace-test");
      const memberId = profile.externalIds.find(
        (e) => e.typeGroup === "member",
      );
      expect(memberId?.externalId).toBe("100000001");
      expect(memberId?.isMemberId).toBe(true);

      // Current position
      expect(profile.currentPosition).not.toBeNull();
      expect(profile.currentPosition?.company).toBe("Babbage Industries");
      expect(profile.currentPosition?.title).toBe("Lead Programmer");

      // Position history with year-month formatting
      expect(profile.positions.length).toBeGreaterThanOrEqual(2);
      const currentPos = profile.positions.find((p) => p.isCurrent);
      expect(currentPos?.company).toBe("Babbage Industries");
      expect(currentPos?.startDate).toBe("2020-03");
      expect(currentPos?.endDate).toBeNull();

      const pastPos = profile.positions.find((p) => !p.isCurrent);
      expect(pastPos?.company).toBe("Difference Engine Co");
      expect(pastPos?.startDate).toBe("2015-09");
      expect(pastPos?.endDate).toBe("2019-12");

      // Education with year-only formatting
      expect(profile.education.length).toBeGreaterThanOrEqual(1);
      const edu = profile.education.find((e) => e.school === "University of Mathematica");
      expect(edu?.degree).toBe("BSc");
      expect(edu?.field).toBe("Mathematics");
      expect(edu?.startDate).toBe("2011");
      expect(edu?.endDate).toBe("2015");

      // Skills (joined from skills table)
      expect(profile.skills.length).toBeGreaterThanOrEqual(2);
      const skillNames = profile.skills.map((s) => s.name);
      expect(skillNames).toContain("Algorithm Design");
      expect(skillNames).toContain("Mechanical Computing");

      // Emails
      expect(profile.emails).toContain("ada@example.test");
    });

    it("assembles a minimal profile without optional data", () => {
      const profile = repo.findById(2);

      expect(profile.id).toBe(2);
      expect(profile.miniProfile.firstName).toBe("Charlie");
      expect(profile.miniProfile.lastName).toBeNull();
      expect(profile.miniProfile.headline).toBeNull();
      expect(profile.miniProfile.avatar).toBeNull();
      expect(profile.currentPosition).toBeNull();
      expect(profile.positions).toEqual([]);
      expect(profile.education).toEqual([]);
      expect(profile.skills).toEqual([]);
      expect(profile.emails).toEqual([]);
    });

    it("assembles a profile with multiple emails", () => {
      const profile = repo.findById(3);

      expect(profile.emails).toHaveLength(2);
      expect(profile.emails).toContain("grace@example.test");
      expect(profile.emails).toContain("grace.personal@example.test");
    });

    it("throws ProfileNotFoundError for a nonexistent ID", () => {
      expect(() => repo.findById(999)).toThrow(ProfileNotFoundError);
    });
  });

  describe("findByPublicId", () => {
    it("resolves a public ID to the correct profile", () => {
      const profile = repo.findByPublicId("ada-lovelace-test");
      expect(profile.id).toBe(1);
      expect(profile.miniProfile.firstName).toBe("Ada");
    });

    it("resolves another public ID", () => {
      const profile = repo.findByPublicId("grace-hopper-test");
      expect(profile.id).toBe(3);
      expect(profile.miniProfile.firstName).toBe("Grace");
    });

    it("throws ProfileNotFoundError for an unknown public ID", () => {
      expect(() => repo.findByPublicId("no-such-person")).toThrow(
        ProfileNotFoundError,
      );
    });
  });

  describe("cross-table consistency", () => {
    it("external IDs reference the correct person", () => {
      const profile = repo.findById(1);
      // Every external ID should belong to person 1 — verified by
      // the JOIN in the query, but this tests the assembly is coherent.
      for (const extId of profile.externalIds) {
        expect(extId.externalId).toBeTruthy();
        expect(["member", "public", "hash", "avatar"]).toContain(
          extId.typeGroup,
        );
      }
    });

    it("current position and position history agree on current role", () => {
      const profile = repo.findById(1);
      const currentPos = profile.positions.find((p) => p.isCurrent);

      expect(profile.currentPosition).not.toBeNull();
      expect(currentPos).toBeDefined();
      // The current_position table and positions table should show the same company
      expect(profile.currentPosition?.company).toBe(currentPos?.company);
    });
  });

  describe("search", () => {
    it("returns all profiles when no filters provided", () => {
      const result = repo.search({});

      expect(result.total).toBe(4);
      expect(result.profiles).toHaveLength(4);
      // Verify all known test profiles are present
      const names = result.profiles.map((p) => p.firstName);
      expect(names).toContain("Ada");
      expect(names).toContain("Charlie");
      expect(names).toContain("Grace");
      expect(names).toContain("Alan");
    });

    it("filters by first name", () => {
      const result = repo.search({ query: "Ada" });

      expect(result.total).toBe(1);
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.firstName).toBe("Ada");
      expect(result.profiles[0]?.lastName).toBe("Lovelace");
    });

    it("filters by last name", () => {
      const result = repo.search({ query: "Hopper" });

      expect(result.total).toBe(1);
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.firstName).toBe("Grace");
    });

    it("filters by headline content", () => {
      const result = repo.search({ query: "Compiler" });

      expect(result.total).toBe(1);
      expect(result.profiles[0]?.firstName).toBe("Grace");
      expect(result.profiles[0]?.headline).toContain("Compiler");
    });

    it("filters by company name", () => {
      const result = repo.search({ company: "Babbage" });

      expect(result.total).toBe(1);
      expect(result.profiles[0]?.company).toBe("Babbage Industries");
    });

    it("combines query and company filters with AND logic", () => {
      // Grace works at COBOL Systems, Ada at Babbage
      const result = repo.search({ query: "Grace", company: "COBOL" });

      expect(result.total).toBe(1);
      expect(result.profiles[0]?.firstName).toBe("Grace");

      // Query for Grace but company filter for Babbage should return empty
      const noMatch = repo.search({ query: "Grace", company: "Babbage" });
      expect(noMatch.total).toBe(0);
    });

    it("returns correct ProfileSummary fields", () => {
      const result = repo.search({ query: "Ada" });
      const profile = result.profiles[0];

      expect(profile?.id).toBe(1);
      expect(profile?.firstName).toBe("Ada");
      expect(profile?.lastName).toBe("Lovelace");
      expect(profile?.headline).toBe("Principal Analytical Engine Programmer");
      expect(profile?.company).toBe("Babbage Industries");
      expect(profile?.title).toBe("Lead Programmer");
    });

    it("handles profiles without current position", () => {
      // Charlie has no current position in the fixture
      const result = repo.search({ query: "Charlie" });

      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.company).toBeNull();
      expect(result.profiles[0]?.title).toBeNull();
    });

    it("applies limit parameter", () => {
      const result = repo.search({ limit: 2 });

      // Total should still reflect all matching records
      expect(result.total).toBe(4);
      // But only limit records returned
      expect(result.profiles).toHaveLength(2);
    });

    it("applies offset parameter for pagination", () => {
      const page1 = repo.search({ limit: 2, offset: 0 });
      const page2 = repo.search({ limit: 2, offset: 2 });

      expect(page1.profiles).toHaveLength(2);
      expect(page2.profiles).toHaveLength(2);
      // Ensure no overlap
      const page1Ids = page1.profiles.map((p) => p.id);
      const page2Ids = page2.profiles.map((p) => p.id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });

    it("returns empty when no matches found", () => {
      const result = repo.search({ query: "NonexistentPerson" });

      expect(result.total).toBe(0);
      expect(result.profiles).toHaveLength(0);
    });

    it("performs case-insensitive LIKE matching", () => {
      // Search with different cases
      const lower = repo.search({ query: "ada" });
      const upper = repo.search({ query: "ADA" });
      const mixed = repo.search({ query: "AdA" });

      // SQLite LIKE is case-insensitive for ASCII by default
      expect(lower.total).toBe(1);
      expect(upper.total).toBe(1);
      expect(mixed.total).toBe(1);
    });

    it("matches partial strings", () => {
      // Partial first name
      const partial = repo.search({ query: "rac" }); // matches "Grace"

      expect(partial.total).toBe(1);
      expect(partial.profiles[0]?.firstName).toBe("Grace");
    });
  });
});
