import { describe, expect, it } from "vitest";
import type {
  CurrentPosition,
  Education,
  ExternalId,
  MiniProfile,
  Position,
  Profile,
  Skill,
} from "./profile.js";

describe("Profile types", () => {
  it("should allow constructing a full Profile", () => {
    const profile: Profile = {
      id: 1,
      miniProfile: {
        firstName: "Jane",
        lastName: "Doe",
        headline: "Software Engineer",
        avatar: "https://example.com/avatar.jpg",
      },
      externalIds: [
        { externalId: "123456", typeGroup: "member", isMemberId: true },
        { externalId: "jane-doe", typeGroup: "public", isMemberId: false },
      ],
      currentPosition: { company: "Acme Corp", title: "Senior Engineer" },
      positions: [
        {
          company: "Acme Corp",
          title: "Senior Engineer",
          startDate: "2023-01",
          endDate: null,
          isCurrent: true,
        },
      ],
      education: [
        {
          school: "MIT",
          degree: "BS",
          field: "Computer Science",
          startDate: "2015",
          endDate: "2019",
        },
      ],
      skills: [{ name: "TypeScript" }],
      emails: ["jane@example.com"],
    };

    expect(profile.id).toBe(1);
    expect(profile.miniProfile.firstName).toBe("Jane");
    expect(profile.externalIds).toHaveLength(2);
    expect(profile.currentPosition?.company).toBe("Acme Corp");
    expect(profile.positions[0]?.isCurrent).toBe(true);
    expect(profile.education[0]?.school).toBe("MIT");
    expect(profile.skills[0]?.name).toBe("TypeScript");
    expect(profile.emails[0]).toBe("jane@example.com");
  });

  it("should allow nullable fields", () => {
    const mini: MiniProfile = {
      firstName: "John",
      lastName: null,
      headline: null,
      avatar: null,
    };
    expect(mini.lastName).toBeNull();

    const position: Position = {
      company: null,
      title: null,
      startDate: null,
      endDate: null,
      isCurrent: false,
    };
    expect(position.company).toBeNull();

    const education: Education = {
      school: null,
      degree: null,
      field: null,
      startDate: null,
      endDate: null,
    };
    expect(education.school).toBeNull();

    const profile: Profile = {
      id: 2,
      miniProfile: mini,
      externalIds: [],
      currentPosition: null,
      positions: [],
      education: [],
      skills: [],
      emails: [],
    };
    expect(profile.currentPosition).toBeNull();
  });

  it("should constrain ExternalId typeGroup to known values", () => {
    const ids: ExternalId[] = [
      { externalId: "1", typeGroup: "member", isMemberId: true },
      { externalId: "2", typeGroup: "public", isMemberId: false },
      { externalId: "3", typeGroup: "hash", isMemberId: false },
      { externalId: "4", typeGroup: "avatar", isMemberId: false },
    ];
    const groups = ids.map((id) => id.typeGroup);
    expect(groups).toEqual(["member", "public", "hash", "avatar"]);
  });

  it("should allow CurrentPosition with nullable fields", () => {
    const cp: CurrentPosition = { company: null, title: null };
    expect(cp.company).toBeNull();
    expect(cp.title).toBeNull();
  });

  it("should allow Skill with name only", () => {
    const skill: Skill = { name: "JavaScript" };
    expect(skill.name).toBe("JavaScript");
  });
});
