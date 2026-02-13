// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseClient } from "../client.js";
import { ProfileNotFoundError } from "../errors.js";
import { openFixture } from "../testing/open-fixture.js";
import { ProfileRepository } from "./profile.js";

describe("ProfileRepository", () => {
  let db: DatabaseSync;
  let client: DatabaseClient;
  let repo: ProfileRepository;

  beforeEach(() => {
    db = openFixture();
    client = { db } as DatabaseClient;
    repo = new ProfileRepository(client);
  });

  afterEach(() => {
    db.close();
  });

  describe("findById", () => {
    it("returns a fully assembled profile", () => {
      const profile = repo.findById(1);

      expect(profile.id).toBe(1);
      expect(profile.miniProfile).toEqual({
        firstName: "Ada",
        lastName: "Lovelace",
        headline: "Principal Analytical Engine Programmer",
        avatar: "https://example.test/avatars/ada.jpg",
      });

      expect(profile.externalIds).toHaveLength(3);
      expect(profile.externalIds).toContainEqual({
        externalId: "ada-lovelace-test",
        typeGroup: "public",
        isMemberId: false,
      });
      expect(profile.externalIds).toContainEqual({
        externalId: "100000001",
        typeGroup: "member",
        isMemberId: true,
      });
      expect(profile.externalIds).toContainEqual({
        externalId: "h4sh-ada-001",
        typeGroup: "hash",
        isMemberId: false,
      });

      expect(profile.currentPosition).toEqual({
        company: "Babbage Industries",
        title: "Lead Programmer",
      });

      expect(profile.positions).toHaveLength(2);
      expect(profile.positions).toContainEqual({
        company: "Babbage Industries",
        title: "Lead Programmer",
        startDate: "2020-03",
        endDate: null,
        isCurrent: true,
      });
      expect(profile.positions).toContainEqual({
        company: "Difference Engine Co",
        title: "Junior Analyst",
        startDate: "2015-09",
        endDate: "2019-12",
        isCurrent: false,
      });

      expect(profile.education).toHaveLength(2);
      expect(profile.education).toContainEqual({
        school: "University of Mathematica",
        degree: "BSc",
        field: "Mathematics",
        startDate: "2011",
        endDate: "2015",
      });
      expect(profile.education).toContainEqual({
        school: "Royal Polytechnic",
        degree: "MSc",
        field: "Computational Logic",
        startDate: "2015",
        endDate: "2017",
      });

      expect(profile.skills).toEqual([
        { name: "Algorithm Design" },
        { name: "Mechanical Computing" },
      ]);

      expect(profile.emails).toEqual(["ada@example.test"]);
    });

    it("throws ProfileNotFoundError for a missing ID", () => {
      expect(() => repo.findById(999)).toThrow(ProfileNotFoundError);
      expect(() => repo.findById(999)).toThrow("Profile not found for id 999");
    });

    it("handles a person with minimal data", () => {
      const profile = repo.findById(2);

      expect(profile.id).toBe(2);
      expect(profile.miniProfile.firstName).toBe("Charlie");
      expect(profile.miniProfile.lastName).toBeNull();
      expect(profile.miniProfile.headline).toBeNull();
      expect(profile.miniProfile.avatar).toBeNull();
      expect(profile.externalIds).toHaveLength(1);
      expect(profile.currentPosition).toBeNull();
      expect(profile.positions).toEqual([]);
      expect(profile.education).toEqual([]);
      expect(profile.skills).toEqual([]);
      expect(profile.emails).toEqual([]);
    });

    it("handles multiple emails", () => {
      const profile = repo.findById(3);

      expect(profile.emails).toHaveLength(2);
      expect(profile.emails).toContain("grace@example.test");
      expect(profile.emails).toContain("grace.personal@example.test");
    });
  });

  describe("findByPublicId", () => {
    it("finds a profile by LinkedIn public ID slug", () => {
      const profile = repo.findByPublicId("ada-lovelace-test");

      expect(profile.id).toBe(1);
      expect(profile.miniProfile.firstName).toBe("Ada");
    });

    it("finds another profile by public ID", () => {
      const profile = repo.findByPublicId("grace-hopper-test");

      expect(profile.id).toBe(3);
      expect(profile.miniProfile.firstName).toBe("Grace");
    });

    it("throws ProfileNotFoundError for an unknown slug", () => {
      expect(() => repo.findByPublicId("nonexistent")).toThrow(
        ProfileNotFoundError,
      );
      expect(() => repo.findByPublicId("nonexistent")).toThrow(
        'Profile not found for public ID "nonexistent"',
      );
    });
  });

  describe("search", () => {
    it("returns all profiles when no filters specified", () => {
      const result = repo.search({});

      expect(result.total).toBe(4);
      expect(result.profiles).toHaveLength(4);
    });

    it("searches by name query", () => {
      const result = repo.search({ query: "Ada" });

      expect(result.total).toBe(1);
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.firstName).toBe("Ada");
      expect(result.profiles[0]?.lastName).toBe("Lovelace");
    });

    it("searches by headline query", () => {
      const result = repo.search({ query: "Compiler" });

      expect(result.total).toBe(1);
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.firstName).toBe("Grace");
    });

    it("filters by company", () => {
      const result = repo.search({ company: "Babbage" });

      expect(result.total).toBe(1);
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.firstName).toBe("Ada");
      expect(result.profiles[0]?.company).toBe("Babbage Industries");
    });

    it("combines query and company filters", () => {
      const result = repo.search({ query: "Grace", company: "COBOL" });

      expect(result.total).toBe(1);
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.firstName).toBe("Grace");
    });

    it("returns empty when no matches", () => {
      const result = repo.search({ query: "Nonexistent" });

      expect(result.total).toBe(0);
      expect(result.profiles).toHaveLength(0);
    });

    it("respects limit parameter", () => {
      const result = repo.search({ limit: 2 });

      expect(result.total).toBe(4);
      expect(result.profiles).toHaveLength(2);
    });

    it("respects offset parameter", () => {
      const result = repo.search({ limit: 2, offset: 1 });

      expect(result.total).toBe(4);
      expect(result.profiles).toHaveLength(2);
    });

    it("returns profile summary with correct fields", () => {
      const result = repo.search({ query: "Ada" });

      expect(result.profiles[0]).toEqual({
        id: 1,
        firstName: "Ada",
        lastName: "Lovelace",
        headline: "Principal Analytical Engine Programmer",
        company: "Babbage Industries",
        title: "Lead Programmer",
      });
    });

    it("handles profiles without current position", () => {
      const result = repo.search({ query: "Charlie" });

      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.company).toBeNull();
      expect(result.profiles[0]?.title).toBeNull();
    });

    it("escapes percent wildcard in search query", () => {
      const result = repo.search({ query: "100%" });

      expect(result.total).toBe(1);
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.firstName).toBe("Alan");
    });

    it("escapes underscore wildcard in search query", () => {
      const result = repo.search({ query: "Enigma_v2" });

      expect(result.total).toBe(1);
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.firstName).toBe("Alan");
    });
  });
});
