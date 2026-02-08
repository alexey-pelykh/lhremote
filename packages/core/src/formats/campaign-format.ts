import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  Campaign,
  CampaignAction,
  CampaignActionConfig,
  CampaignConfig,
} from "../types/index.js";

/** Current version of the campaign document format. */
const CURRENT_VERSION = "1";

/**
 * Campaign document as it appears in YAML/JSON.
 *
 * This is the portable serialization format — not used at runtime.
 * It maps to/from `CampaignConfig` for import and
 * `Campaign` + `CampaignAction[]` for export.
 */
interface CampaignDocument {
  version: string;
  name: string;
  description?: string;
  settings?: CampaignDocumentSettings;
  actions: CampaignDocumentAction[];
}

interface CampaignDocumentSettings {
  cooldownMs?: number;
  maxActionsPerRun?: number;
}

interface CampaignDocumentAction {
  type: string;
  cooldownMs?: number;
  maxActionsPerRun?: number;
  config?: Record<string, unknown>;
}

/**
 * Thrown when a campaign document fails structural validation.
 */
export class CampaignFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignFormatError";
  }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse a YAML string into a CampaignConfig.
 *
 * @throws {CampaignFormatError} if the YAML is malformed or the document
 *   fails structural validation.
 */
export function parseCampaignYaml(yamlString: string): CampaignConfig {
  let doc: unknown;
  try {
    doc = parseYaml(yamlString);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CampaignFormatError(`Invalid YAML: ${message}`);
  }
  return parseCampaignDocument(doc);
}

/**
 * Parse a JSON string into a CampaignConfig.
 *
 * @throws {CampaignFormatError} if the JSON is malformed or the document
 *   fails structural validation.
 */
export function parseCampaignJson(jsonString: string): CampaignConfig {
  let doc: unknown;
  try {
    doc = JSON.parse(jsonString) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CampaignFormatError(`Invalid JSON: ${message}`);
  }
  return parseCampaignDocument(doc);
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/**
 * Serialize a campaign and its actions to a YAML string.
 */
export function serializeCampaignYaml(
  campaign: Campaign,
  actions: CampaignAction[],
): string {
  const doc = toCampaignDocument(campaign, actions);
  return stringifyYaml(doc);
}

/**
 * Serialize a campaign and its actions to a JSON string.
 */
export function serializeCampaignJson(
  campaign: Campaign,
  actions: CampaignAction[],
): string {
  const doc = toCampaignDocument(campaign, actions);
  return JSON.stringify(doc, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Internal: parse
// ---------------------------------------------------------------------------

function parseCampaignDocument(doc: unknown): CampaignConfig {
  if (doc === null || typeof doc !== "object") {
    throw new CampaignFormatError("Campaign document must be an object");
  }

  const obj = doc as Record<string, unknown>;

  // Version
  if (!("version" in obj) || obj["version"] === undefined) {
    throw new CampaignFormatError("Missing required field: version");
  }
  if (String(obj["version"]) !== CURRENT_VERSION) {
    throw new CampaignFormatError(
      `Unsupported version: ${String(obj["version"])} (expected ${CURRENT_VERSION})`,
    );
  }

  // Name
  if (!("name" in obj) || typeof obj["name"] !== "string" || obj["name"].trim() === "") {
    throw new CampaignFormatError("Missing or empty required field: name");
  }
  const name = obj["name"].trim();

  // Description
  const description =
    "description" in obj && typeof obj["description"] === "string"
      ? obj["description"]
      : undefined;

  // Settings (campaign-level defaults)
  const settings = parseDocumentSettings(obj["settings"]);

  // Actions
  if (!("actions" in obj) || obj["actions"] === undefined) {
    throw new CampaignFormatError("Missing required field: actions");
  }
  if (!Array.isArray(obj["actions"])) {
    throw new CampaignFormatError("Invalid field: actions must be an array");
  }
  if (obj["actions"].length === 0) {
    throw new CampaignFormatError("Actions array must not be empty");
  }

  const actions: CampaignActionConfig[] = (obj["actions"] as unknown[]).map(
    (raw, index) => parseDocumentAction(raw, index, settings),
  );

  const config: CampaignConfig = { name, actions };
  if (description !== undefined) {
    config.description = description;
  }
  return config;
}

function parseDocumentSettings(
  raw: unknown,
): CampaignDocumentSettings {
  if (raw === null || raw === undefined) {
    return {};
  }

  if (Array.isArray(raw) || typeof raw !== "object") {
    throw new CampaignFormatError("Invalid field: settings must be an object");
  }

  const obj = raw as Record<string, unknown>;
  const settings: CampaignDocumentSettings = {};

  if ("cooldownMs" in obj && typeof obj["cooldownMs"] === "number" && Number.isFinite(obj["cooldownMs"])) {
    settings.cooldownMs = obj["cooldownMs"];
  }
  if ("maxActionsPerRun" in obj && typeof obj["maxActionsPerRun"] === "number" && Number.isFinite(obj["maxActionsPerRun"])) {
    settings.maxActionsPerRun = obj["maxActionsPerRun"];
  }

  return settings;
}

function parseDocumentAction(
  raw: unknown,
  index: number,
  defaults: CampaignDocumentSettings,
): CampaignActionConfig {
  if (raw === null || typeof raw !== "object") {
    throw new CampaignFormatError(
      `Action at index ${String(index)} must be an object`,
    );
  }

  const obj = raw as Record<string, unknown>;

  if (!("type" in obj) || typeof obj["type"] !== "string" || obj["type"].trim() === "") {
    throw new CampaignFormatError(
      `Action at index ${String(index)} is missing required field: type`,
    );
  }

  const actionType = obj["type"].trim();
  const actionSettings =
    "config" in obj && obj["config"] !== null && typeof obj["config"] === "object" && !Array.isArray(obj["config"])
      ? (obj["config"] as Record<string, unknown>)
      : undefined;

  const action: CampaignActionConfig = {
    name: actionType,
    actionType,
  };

  if (actionSettings !== undefined) {
    action.actionSettings = actionSettings;
  }

  // Apply coolDown: per-action override > campaign-level default
  const coolDown = getFiniteNumberField(obj, "cooldownMs") ?? defaults.cooldownMs;
  if (coolDown !== undefined) {
    action.coolDown = coolDown;
  }

  // Apply maxActionResultsPerIteration: per-action > campaign-level
  const maxActions =
    getFiniteNumberField(obj, "maxActionsPerRun") ?? defaults.maxActionsPerRun;
  if (maxActions !== undefined) {
    action.maxActionResultsPerIteration = maxActions;
  }

  return action;
}

function getFiniteNumberField(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  if (key in obj && typeof obj[key] === "number" && Number.isFinite(obj[key])) {
    return obj[key];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Internal: serialize
// ---------------------------------------------------------------------------

function toCampaignDocument(
  campaign: Campaign,
  actions: CampaignAction[],
): CampaignDocument {
  // Extract common settings first so we know what goes at campaign-level
  const commonSettings = extractCommonSettings(actions);

  const docActions: CampaignDocumentAction[] = actions.map((a) => {
    const docAction: CampaignDocumentAction = { type: a.config.actionType };
    const settings = a.config.actionSettings;

    if (settings !== undefined && Object.keys(settings).length > 0) {
      docAction.config = settings;
    }

    // Emit per-action settings when they differ from campaign-level defaults
    const coolDown = a.config.coolDown;
    if (commonSettings?.cooldownMs === undefined && Number.isFinite(coolDown)) {
      docAction.cooldownMs = coolDown;
    }
    const maxResults = a.config.maxActionResultsPerIteration;
    if (commonSettings?.maxActionsPerRun === undefined && Number.isFinite(maxResults)) {
      docAction.maxActionsPerRun = maxResults;
    }

    return docAction;
  });

  const doc: CampaignDocument = {
    version: CURRENT_VERSION,
    name: campaign.name,
    actions: docActions,
  };

  if (campaign.description !== null) {
    doc.description = campaign.description;
  }

  if (commonSettings !== undefined) {
    doc.settings = commonSettings;
  }

  return doc;
}

function extractCommonSettings(
  actions: CampaignAction[],
): CampaignDocumentSettings | undefined {
  if (actions.length === 0) return undefined;

  const first = actions[0];
  if (first === undefined) return undefined;

  const coolDown = first.config.coolDown;
  const maxResults = first.config.maxActionResultsPerIteration;

  const allSameCoolDown = actions.every((a) => a.config.coolDown === coolDown);
  const allSameMaxResults = actions.every(
    (a) => a.config.maxActionResultsPerIteration === maxResults,
  );

  if (!allSameCoolDown && !allSameMaxResults) return undefined;

  const settings: CampaignDocumentSettings = {};
  if (allSameCoolDown) {
    settings.cooldownMs = coolDown;
  }
  if (allSameMaxResults) {
    settings.maxActionsPerRun = maxResults;
  }

  return settings;
}
