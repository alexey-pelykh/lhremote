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
});
