import { describe, it, expect } from "vitest";

import {
  getActionTypeCatalog,
  getActionTypeInfo,
  type ActionType,
  type ActionCategory,
} from "./action-types.js";

describe("getActionTypeCatalog", () => {
  it("returns all action types when no category is specified", () => {
    const catalog = getActionTypeCatalog();

    expect(catalog.actionTypes).toHaveLength(13);

    const names = catalog.actionTypes.map((t) => t.name);
    expect(names).toContain("VisitAndExtract");
    expect(names).toContain("MessageToPerson");
    expect(names).toContain("InMail");
    expect(names).toContain("InvitePerson");
    expect(names).toContain("Follow");
    expect(names).toContain("EndorseSkills");
    expect(names).toContain("CheckForReplies");
    expect(names).toContain("ScrapeMessagingHistory");
    expect(names).toContain("Waiter");
    expect(names).toContain("DataEnrichment");
    expect(names).toContain("PersonPostsLiker");
    expect(names).toContain("RemoveFromFirstConnection");
    expect(names).toContain("FilterContactsOutOfMyNetwork");
  });

  it("filters by category", () => {
    const messaging = getActionTypeCatalog("messaging");

    expect(messaging.actionTypes.length).toBeGreaterThan(0);
    for (const info of messaging.actionTypes) {
      expect(info.category).toBe("messaging");
    }

    const names = messaging.actionTypes.map((t) => t.name);
    expect(names).toContain("MessageToPerson");
    expect(names).toContain("InMail");
    expect(names).toContain("CheckForReplies");
    expect(names).toContain("ScrapeMessagingHistory");
  });

  it("returns people category types", () => {
    const people = getActionTypeCatalog("people");
    const names = people.actionTypes.map((t) => t.name);
    expect(names).toContain("VisitAndExtract");
    expect(names).toContain("InvitePerson");
    expect(names).toContain("RemoveFromFirstConnection");
  });

  it("returns engagement category types", () => {
    const engagement = getActionTypeCatalog("engagement");
    const names = engagement.actionTypes.map((t) => t.name);
    expect(names).toContain("Follow");
    expect(names).toContain("EndorseSkills");
    expect(names).toContain("PersonPostsLiker");
  });

  it("returns crm category types", () => {
    const crm = getActionTypeCatalog("crm");
    const names = crm.actionTypes.map((t) => t.name);
    expect(names).toContain("DataEnrichment");
    expect(names).toContain("FilterContactsOutOfMyNetwork");
  });

  it("returns workflow category types", () => {
    const workflow = getActionTypeCatalog("workflow");
    const names = workflow.actionTypes.map((t) => t.name);
    expect(names).toContain("Waiter");
  });

  it("returns a new array on each call", () => {
    const catalog1 = getActionTypeCatalog();
    const catalog2 = getActionTypeCatalog();
    expect(catalog1.actionTypes).not.toBe(catalog2.actionTypes);
  });

  it("returns frozen action type objects", () => {
    const catalog = getActionTypeCatalog();
    for (const info of catalog.actionTypes) {
      expect(Object.isFrozen(info)).toBe(true);
      expect(Object.isFrozen(info.configSchema)).toBe(true);
    }
  });

  it("every action type has required fields", () => {
    const catalog = getActionTypeCatalog();
    for (const info of catalog.actionTypes) {
      expect(info.name).toBeTruthy();
      expect(info.description).toBeTruthy();
      expect(info.category).toBeTruthy();
      expect(info.configSchema).toBeDefined();
    }
  });

  it("every action type has a valid category", () => {
    const validCategories: ActionCategory[] = [
      "people",
      "messaging",
      "engagement",
      "crm",
      "workflow",
    ];
    const catalog = getActionTypeCatalog();
    for (const info of catalog.actionTypes) {
      expect(validCategories).toContain(info.category);
    }
  });

  it("categories are exhaustive (every category has at least one type)", () => {
    const categories: ActionCategory[] = [
      "people",
      "messaging",
      "engagement",
      "crm",
      "workflow",
    ];
    for (const category of categories) {
      const catalog = getActionTypeCatalog(category);
      expect(catalog.actionTypes.length).toBeGreaterThan(0);
    }
  });
});

describe("getActionTypeInfo", () => {
  it("returns info for known action types", () => {
    const knownTypes: ActionType[] = [
      "VisitAndExtract",
      "MessageToPerson",
      "InMail",
      "InvitePerson",
      "Follow",
      "EndorseSkills",
      "CheckForReplies",
      "ScrapeMessagingHistory",
      "Waiter",
      "DataEnrichment",
      "PersonPostsLiker",
      "RemoveFromFirstConnection",
      "FilterContactsOutOfMyNetwork",
    ];

    for (const typeName of knownTypes) {
      const info = getActionTypeInfo(typeName);
      expect(info).toBeDefined();
      if (info === undefined) throw new Error(`Expected info for ${typeName}`);
      expect(info.name).toBe(typeName);
    }
  });

  it("returns undefined for unknown action type", () => {
    expect(getActionTypeInfo("NonExistentAction")).toBeUndefined();
  });

  it("returns correct fields for VisitAndExtract", () => {
    const info = getActionTypeInfo("VisitAndExtract");
    expect(info).toBeDefined();
    if (info === undefined) throw new Error("Expected info");
    expect(info.category).toBe("people");
    expect(info.configSchema).toHaveProperty("extractProfile");
    const field = info.configSchema["extractProfile"];
    expect(field).toBeDefined();
    if (field === undefined) throw new Error("Expected field");
    expect(field.type).toBe("boolean");
  });

  it("returns correct fields for MessageToPerson", () => {
    const info = getActionTypeInfo("MessageToPerson");
    expect(info).toBeDefined();
    if (info === undefined) throw new Error("Expected info");
    expect(info.category).toBe("messaging");
    expect(info.configSchema).toHaveProperty("messageTemplate");
    const field = info.configSchema["messageTemplate"];
    expect(field).toBeDefined();
    if (field === undefined) throw new Error("Expected field");
    expect(field.required).toBe(true);
    expect(info.configSchema).toHaveProperty("rejectIfReplied");
  });

  it("returns correct fields for Waiter", () => {
    const info = getActionTypeInfo("Waiter");
    expect(info).toBeDefined();
    if (info === undefined) throw new Error("Expected info");
    expect(info.category).toBe("workflow");
    expect(info.configSchema).toHaveProperty("delay");
    const field = info.configSchema["delay"];
    expect(field).toBeDefined();
    if (field === undefined) throw new Error("Expected field");
    expect(field.required).toBe(true);
    expect(field.type).toBe("number");
  });

  it("returns example when available", () => {
    const info = getActionTypeInfo("VisitAndExtract");
    expect(info).toBeDefined();
    if (info === undefined) throw new Error("Expected info");
    expect(info.example).toEqual({ extractProfile: true });
  });

  it("returns correct fields for CheckForReplies", () => {
    const info = getActionTypeInfo("CheckForReplies");
    expect(info).toBeDefined();
    if (info === undefined) throw new Error("Expected info");
    expect(info.category).toBe("messaging");
    expect(info.configSchema).toHaveProperty("moveToSuccessfulAfterMs");
    const moveField = info.configSchema["moveToSuccessfulAfterMs"];
    expect(moveField).toBeDefined();
    if (moveField === undefined) throw new Error("Expected field");
    expect(moveField.type).toBe("number");
    expect(moveField.required).toBe(true);
    expect(info.configSchema).toHaveProperty("treatMessageAcceptedAsReply");
    expect(info.configSchema).toHaveProperty("keepInQueueIfRequestIsNotAccepted");
    expect(info.example).toEqual({
      moveToSuccessfulAfterMs: 86400000,
      treatMessageAcceptedAsReply: false,
      keepInQueueIfRequestIsNotAccepted: true,
    });
  });

  it("returns correct fields for DataEnrichment", () => {
    const info = getActionTypeInfo("DataEnrichment");
    expect(info).toBeDefined();
    if (info === undefined) throw new Error("Expected info");
    expect(info.category).toBe("crm");
    expect(info.configSchema).toHaveProperty("profileInfo");
    expect(info.configSchema).toHaveProperty("phones");
    expect(info.configSchema).toHaveProperty("emails");
    expect(info.configSchema).toHaveProperty("socials");
    expect(info.configSchema).toHaveProperty("companies");
    expect(info.configSchema).toHaveProperty("actualDate");
    const profileInfoField = info.configSchema["profileInfo"];
    expect(profileInfoField).toBeDefined();
    if (profileInfoField === undefined) throw new Error("Expected field");
    expect(profileInfoField.type).toBe("object");
    expect(profileInfoField.required).toBe(true);
    const emailsField = info.configSchema["emails"];
    expect(emailsField).toBeDefined();
    if (emailsField === undefined) throw new Error("Expected field");
    expect(emailsField.type).toBe("object");
    expect(emailsField.required).toBe(true);
    const actualDateField = info.configSchema["actualDate"];
    expect(actualDateField).toBeDefined();
    if (actualDateField === undefined) throw new Error("Expected field");
    expect(actualDateField.type).toBe("number");
    expect(actualDateField.required).toBe(false);
    expect(info.example).toEqual({
      profileInfo: { shouldEnrich: false },
      phones: { shouldEnrich: false },
      emails: { shouldEnrich: false, types: ["personal", "business"] },
      socials: { shouldEnrich: false },
      companies: { shouldEnrich: true },
    });
  });

  it("returns correct fields for FilterContactsOutOfMyNetwork", () => {
    const info = getActionTypeInfo("FilterContactsOutOfMyNetwork");
    expect(info).toBeDefined();
    if (info === undefined) throw new Error("Expected info");
    expect(info.category).toBe("crm");
    expect(info.configSchema).toHaveProperty("maxScrollDepth");
    expect(info.configSchema).toHaveProperty("checkUntil");
    expect(info.configSchema).toHaveProperty("launchAutoAcceptInvites");
    expect(info.configSchema).toHaveProperty("launchAutoCancelInvites");
    expect(info.configSchema).toHaveProperty("cancelInvitesOlderThan");
    const scrollField = info.configSchema["maxScrollDepth"];
    expect(scrollField).toBeDefined();
    if (scrollField === undefined) throw new Error("Expected field");
    expect(scrollField.type).toBe("number");
    expect(scrollField.required).toBe(false);
    const checkUntilField = info.configSchema["checkUntil"];
    expect(checkUntilField).toBeDefined();
    if (checkUntilField === undefined) throw new Error("Expected field");
    expect(checkUntilField.type).toBe("string");
    expect(info.example).toEqual({
      maxScrollDepth: 200,
      checkUntil: "PreviouslyFound",
      cancelInvitesOlderThan: 2592000000,
      launchAutoAcceptInvites: false,
      launchAutoCancelInvites: true,
    });
  });

  it("returns frozen objects", () => {
    const info = getActionTypeInfo("VisitAndExtract");
    expect(info).toBeDefined();
    if (info === undefined) throw new Error("Expected info");
    expect(Object.isFrozen(info)).toBe(true);
    expect(Object.isFrozen(info.configSchema)).toBe(true);
  });
});
