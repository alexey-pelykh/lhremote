import { describe, expect, it } from "vitest";

import type { Campaign, CampaignAction } from "../types/index.js";
import {
  CampaignFormatError,
  parseCampaignJson,
  parseCampaignYaml,
  serializeCampaignJson,
  serializeCampaignYaml,
} from "./campaign-format.js";

const MINIMAL_YAML = `
version: "1"
name: "Test Campaign"
actions:
  - type: VisitAndExtract
`;

const FULL_YAML = `
version: "1"
name: "Outreach Campaign"
description: "A test campaign"
settings:
  cooldownMs: 30000
  maxActionsPerRun: 5
actions:
  - type: VisitAndExtract
    config:
      extractProfile: true
  - type: MessageToPerson
    config:
      messageTemplate: "Hi {firstName}"
`;

const MOCK_CAMPAIGN: Campaign = {
  id: 1,
  name: "Test Campaign",
  description: "Test description",
  state: "paused",
  liAccountId: 1,
  isPaused: true,
  isArchived: false,
  isValid: true,
  createdAt: "2025-01-15T00:00:00Z",
};

const MOCK_ACTIONS: CampaignAction[] = [
  {
    id: 10,
    campaignId: 1,
    name: "Visit & Extract",
    description: null,
    config: {
      id: 100,
      actionType: "VisitAndExtract",
      actionSettings: { extractProfile: true },
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 1000,
  },
  {
    id: 11,
    campaignId: 1,
    name: "Message",
    description: null,
    config: {
      id: 101,
      actionType: "MessageToPerson",
      actionSettings: { messageTemplate: "Hi {firstName}" },
      coolDown: 60000,
      maxActionResultsPerIteration: 10,
      isDraft: false,
    },
    versionId: 1001,
  },
];

describe("parseCampaignYaml", () => {
  it("parses minimal valid YAML", () => {
    const config = parseCampaignYaml(MINIMAL_YAML);

    expect(config.name).toBe("Test Campaign");
    expect(config.description).toBeUndefined();
    expect(config.actions).toHaveLength(1);
    expect(config.actions[0]?.actionType).toBe("VisitAndExtract");
  });

  it("parses full YAML with settings and description", () => {
    const config = parseCampaignYaml(FULL_YAML);

    expect(config.name).toBe("Outreach Campaign");
    expect(config.description).toBe("A test campaign");
    expect(config.actions).toHaveLength(2);
    expect(config.actions[0]?.actionType).toBe("VisitAndExtract");
    expect(config.actions[0]?.actionSettings).toEqual({ extractProfile: true });
    expect(config.actions[1]?.actionType).toBe("MessageToPerson");
    expect(config.actions[1]?.actionSettings).toEqual({
      messageTemplate: "Hi {firstName}",
    });
  });

  it("applies campaign-level settings as action defaults", () => {
    const config = parseCampaignYaml(FULL_YAML);

    expect(config.actions[0]?.coolDown).toBe(30000);
    expect(config.actions[0]?.maxActionResultsPerIteration).toBe(5);
    expect(config.actions[1]?.coolDown).toBe(30000);
    expect(config.actions[1]?.maxActionResultsPerIteration).toBe(5);
  });

  it("allows per-action overrides of settings", () => {
    const yaml = `
version: "1"
name: "Test"
settings:
  cooldownMs: 30000
  maxActionsPerRun: 5
actions:
  - type: VisitAndExtract
    cooldownMs: 10000
    maxActionsPerRun: 20
`;
    const config = parseCampaignYaml(yaml);

    expect(config.actions[0]?.coolDown).toBe(10000);
    expect(config.actions[0]?.maxActionResultsPerIteration).toBe(20);
  });

  it("derives action name from type", () => {
    const config = parseCampaignYaml(MINIMAL_YAML);

    expect(config.actions[0]?.name).toBe("VisitAndExtract");
  });

  it("does not set coolDown/maxActionResultsPerIteration when no settings", () => {
    const config = parseCampaignYaml(MINIMAL_YAML);

    expect(config.actions[0]?.coolDown).toBeUndefined();
    expect(config.actions[0]?.maxActionResultsPerIteration).toBeUndefined();
  });

  it("throws CampaignFormatError for missing version", () => {
    const yaml = `
name: "Test"
actions:
  - type: VisitAndExtract
`;
    expect(() => parseCampaignYaml(yaml)).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml(yaml)).toThrow("Missing required field: version");
  });

  it("throws CampaignFormatError for wrong version", () => {
    const yaml = `
version: "2"
name: "Test"
actions:
  - type: VisitAndExtract
`;
    expect(() => parseCampaignYaml(yaml)).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml(yaml)).toThrow("Unsupported version: 2");
  });

  it("throws CampaignFormatError for missing name", () => {
    const yaml = `
version: "1"
actions:
  - type: VisitAndExtract
`;
    expect(() => parseCampaignYaml(yaml)).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml(yaml)).toThrow("Missing or empty required field: name");
  });

  it("throws CampaignFormatError for empty name", () => {
    const yaml = `
version: "1"
name: ""
actions:
  - type: VisitAndExtract
`;
    expect(() => parseCampaignYaml(yaml)).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml(yaml)).toThrow("Missing or empty required field: name");
  });

  it("throws CampaignFormatError for missing actions", () => {
    const yaml = `
version: "1"
name: "Test"
`;
    expect(() => parseCampaignYaml(yaml)).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml(yaml)).toThrow("Missing required field: actions");
  });

  it("throws CampaignFormatError for non-array actions", () => {
    const yaml = `
version: "1"
name: "Test"
actions: "visit"
`;
    expect(() => parseCampaignYaml(yaml)).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml(yaml)).toThrow("Invalid field: actions must be an array");
  });

  it("throws CampaignFormatError for non-object settings", () => {
    const yaml = `
version: "1"
name: "Test"
settings: "fast"
actions:
  - type: VisitAndExtract
`;
    expect(() => parseCampaignYaml(yaml)).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml(yaml)).toThrow(
      "Invalid field: settings must be an object",
    );
  });

  it("throws CampaignFormatError for array settings", () => {
    const json = JSON.stringify({
      version: "1",
      name: "Test",
      settings: [1, 2, 3],
      actions: [{ type: "VisitAndExtract" }],
    });
    expect(() => parseCampaignJson(json)).toThrow(CampaignFormatError);
    expect(() => parseCampaignJson(json)).toThrow(
      "Invalid field: settings must be an object",
    );
  });

  it("ignores non-numeric cooldownMs in settings", () => {
    const json = JSON.stringify({
      version: "1",
      name: "Test",
      settings: { cooldownMs: null, maxActionsPerRun: 5 },
      actions: [{ type: "VisitAndExtract" }],
    });
    const config = parseCampaignJson(json);
    expect(config.actions[0]?.coolDown).toBeUndefined();
    expect(config.actions[0]?.maxActionResultsPerIteration).toBe(5);
  });

  it("ignores NaN and Infinity in settings via YAML", () => {
    const yaml = `
version: "1"
name: "Test"
settings:
  cooldownMs: .nan
  maxActionsPerRun: .inf
actions:
  - type: VisitAndExtract
`;
    const config = parseCampaignYaml(yaml);
    expect(config.actions[0]?.coolDown).toBeUndefined();
    expect(config.actions[0]?.maxActionResultsPerIteration).toBeUndefined();
  });

  it("ignores array config in actions", () => {
    const json = JSON.stringify({
      version: "1",
      name: "Test",
      actions: [{ type: "VisitAndExtract", config: [1, 2, 3] }],
    });
    const config = parseCampaignJson(json);
    expect(config.actions[0]?.actionSettings).toBeUndefined();
  });

  it("throws CampaignFormatError for empty actions array", () => {
    const yaml = `
version: "1"
name: "Test"
actions: []
`;
    expect(() => parseCampaignYaml(yaml)).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml(yaml)).toThrow("Actions array must not be empty");
  });

  it("throws CampaignFormatError for action without type", () => {
    const yaml = `
version: "1"
name: "Test"
actions:
  - config:
      extractProfile: true
`;
    expect(() => parseCampaignYaml(yaml)).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml(yaml)).toThrow(
      "Action at index 0 is missing required field: type",
    );
  });

  it("throws CampaignFormatError for invalid YAML syntax", () => {
    expect(() => parseCampaignYaml("{{invalid")).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml("{{invalid")).toThrow("Invalid YAML");
  });

  it("throws CampaignFormatError for non-object document", () => {
    expect(() => parseCampaignYaml("just a string")).toThrow(CampaignFormatError);
    expect(() => parseCampaignYaml("just a string")).toThrow(
      "Campaign document must be an object",
    );
  });
});

describe("parseCampaignJson", () => {
  it("parses valid JSON", () => {
    const json = JSON.stringify({
      version: "1",
      name: "Test Campaign",
      actions: [{ type: "VisitAndExtract" }],
    });
    const config = parseCampaignJson(json);

    expect(config.name).toBe("Test Campaign");
    expect(config.actions).toHaveLength(1);
    expect(config.actions[0]?.actionType).toBe("VisitAndExtract");
  });

  it("throws CampaignFormatError for invalid JSON syntax", () => {
    expect(() => parseCampaignJson("{invalid}")).toThrow(CampaignFormatError);
    expect(() => parseCampaignJson("{invalid}")).toThrow("Invalid JSON");
  });

  it("throws CampaignFormatError for invalid document structure", () => {
    expect(() => parseCampaignJson('"just a string"')).toThrow(CampaignFormatError);
  });
});

describe("serializeCampaignYaml", () => {
  it("serializes campaign with uniform settings to campaign-level", () => {
    const yaml = serializeCampaignYaml(MOCK_CAMPAIGN, MOCK_ACTIONS);

    expect(yaml).toContain("version:");
    expect(yaml).toContain('name: Test Campaign');
    expect(yaml).toContain("description: Test description");
    expect(yaml).toContain("cooldownMs: 60000");
    expect(yaml).toContain("maxActionsPerRun: 10");
    expect(yaml).toContain("type: VisitAndExtract");
    expect(yaml).toContain("type: MessageToPerson");
  });

  it("serializes campaign with varied settings as per-action overrides", () => {
    const action0 = MOCK_ACTIONS[0] as CampaignAction;
    const action1 = MOCK_ACTIONS[1] as CampaignAction;
    const variedActions: CampaignAction[] = [
      {
        ...action0,
        config: { ...action0.config, coolDown: 30000 },
      },
      {
        ...action1,
        config: { ...action1.config, coolDown: 60000 },
      },
    ];
    const yaml = serializeCampaignYaml(MOCK_CAMPAIGN, variedActions);

    // cooldownMs should NOT be at campaign-level settings since they differ
    // but maxActionsPerRun is still uniform so should be in settings
    expect(yaml).toContain("maxActionsPerRun: 10");
    // per-action cooldownMs should be present
    expect(yaml).toContain("cooldownMs: 30000");
    expect(yaml).toContain("cooldownMs: 60000");
  });

  it("includes description when non-null", () => {
    const yaml = serializeCampaignYaml(MOCK_CAMPAIGN, MOCK_ACTIONS);

    expect(yaml).toContain("description: Test description");
  });

  it("omits description when null", () => {
    const campaign = { ...MOCK_CAMPAIGN, description: null };
    const yaml = serializeCampaignYaml(campaign, MOCK_ACTIONS);

    expect(yaml).not.toContain("description:");
  });

  it("omits empty actionSettings from config", () => {
    const action0 = MOCK_ACTIONS[0] as CampaignAction;
    const actions: CampaignAction[] = [
      {
        ...action0,
        config: { ...action0.config, actionSettings: {} },
      },
    ];
    const yaml = serializeCampaignYaml(MOCK_CAMPAIGN, actions);

    expect(yaml).not.toContain("config:");
  });

  it("includes non-empty actionSettings as config", () => {
    const yaml = serializeCampaignYaml(MOCK_CAMPAIGN, MOCK_ACTIONS);

    expect(yaml).toContain("extractProfile: true");
    expect(yaml).toContain("messageTemplate:");
  });
});

describe("serializeCampaignJson", () => {
  it("serializes to pretty-printed JSON", () => {
    const json = serializeCampaignJson(MOCK_CAMPAIGN, MOCK_ACTIONS);

    expect(() => JSON.parse(json)).not.toThrow();
    const doc = JSON.parse(json) as Record<string, unknown>;
    expect(doc["version"]).toBe("1");
    expect(doc["name"]).toBe("Test Campaign");
  });

  it("produces valid JSON that round-trips through parseCampaignJson", () => {
    const json = serializeCampaignJson(MOCK_CAMPAIGN, MOCK_ACTIONS);
    const config = parseCampaignJson(json);

    expect(config.name).toBe("Test Campaign");
    expect(config.description).toBe("Test description");
    expect(config.actions).toHaveLength(2);
    expect(config.actions[0]?.actionType).toBe("VisitAndExtract");
    expect(config.actions[1]?.actionType).toBe("MessageToPerson");
  });
});

describe("round-trip", () => {
  it("YAML: serialize → parse preserves campaign data", () => {
    const yaml = serializeCampaignYaml(MOCK_CAMPAIGN, MOCK_ACTIONS);
    const config = parseCampaignYaml(yaml);

    expect(config.name).toBe("Test Campaign");
    expect(config.description).toBe("Test description");
    expect(config.actions).toHaveLength(2);
    expect(config.actions[0]?.actionType).toBe("VisitAndExtract");
    expect(config.actions[0]?.actionSettings).toEqual({ extractProfile: true });
    expect(config.actions[0]?.coolDown).toBe(60000);
    expect(config.actions[0]?.maxActionResultsPerIteration).toBe(10);
    expect(config.actions[1]?.actionType).toBe("MessageToPerson");
    expect(config.actions[1]?.actionSettings).toEqual({
      messageTemplate: "Hi {firstName}",
    });
  });

  it("JSON: serialize → parse preserves campaign data", () => {
    const json = serializeCampaignJson(MOCK_CAMPAIGN, MOCK_ACTIONS);
    const config = parseCampaignJson(json);

    expect(config.name).toBe("Test Campaign");
    expect(config.description).toBe("Test description");
    expect(config.actions).toHaveLength(2);
    expect(config.actions[0]?.actionType).toBe("VisitAndExtract");
    expect(config.actions[0]?.actionSettings).toEqual({ extractProfile: true });
    expect(config.actions[1]?.actionType).toBe("MessageToPerson");
  });

  it("YAML: serialize → parse preserves varied per-action settings", () => {
    const action0 = MOCK_ACTIONS[0] as CampaignAction;
    const action1 = MOCK_ACTIONS[1] as CampaignAction;
    const variedActions: CampaignAction[] = [
      {
        ...action0,
        config: { ...action0.config, coolDown: 30000, maxActionResultsPerIteration: 5 },
      },
      {
        ...action1,
        config: { ...action1.config, coolDown: 60000, maxActionResultsPerIteration: 20 },
      },
    ];
    const yaml = serializeCampaignYaml(MOCK_CAMPAIGN, variedActions);
    const config = parseCampaignYaml(yaml);

    expect(config.actions[0]?.coolDown).toBe(30000);
    expect(config.actions[0]?.maxActionResultsPerIteration).toBe(5);
    expect(config.actions[1]?.coolDown).toBe(60000);
    expect(config.actions[1]?.maxActionResultsPerIteration).toBe(20);
  });

  it("parse → serialize → parse produces identical config", () => {
    const config1 = parseCampaignYaml(FULL_YAML);

    // Create a mock campaign and actions from parsed config to simulate DB state
    const campaign: Campaign = {
      id: 1,
      name: config1.name,
      description: config1.description ?? null,
      state: "active",
      liAccountId: 1,
      isPaused: false,
      isArchived: false,
      isValid: true,
      createdAt: "2025-01-15T00:00:00Z",
    };
    const actions: CampaignAction[] = config1.actions.map((a, i) => ({
      id: i + 1,
      campaignId: 1,
      name: a.name,
      description: null,
      config: {
        id: i + 100,
        actionType: a.actionType,
        actionSettings: a.actionSettings ?? {},
        coolDown: a.coolDown ?? 60000,
        maxActionResultsPerIteration: a.maxActionResultsPerIteration ?? 10,
        isDraft: false,
      },
      versionId: i + 1000,
    }));

    const yaml = serializeCampaignYaml(campaign, actions);
    const config2 = parseCampaignYaml(yaml);

    expect(config2.name).toBe(config1.name);
    expect(config2.description).toBe(config1.description);
    expect(config2.actions).toHaveLength(config1.actions.length);
    for (let i = 0; i < config1.actions.length; i++) {
      expect(config2.actions[i]?.actionType).toBe(config1.actions[i]?.actionType);
      expect(config2.actions[i]?.actionSettings).toEqual(
        config1.actions[i]?.actionSettings,
      );
    }
  });
});
