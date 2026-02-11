/**
 * LinkedHelper action type identifiers.
 *
 * These correspond to the `actionType` column in the `action_configs` table.
 */
export type ActionType =
  | "CheckForReplies"
  | "DataEnrichment"
  | "EndorseSkills"
  | "FilterContactsOutOfMyNetwork"
  | "Follow"
  | "InMail"
  | "InvitePerson"
  | "MessageToPerson"
  | "PersonPostsLiker"
  | "RemoveFromFirstConnection"
  | "ScrapeMessagingHistory"
  | "VisitAndExtract"
  | "Waiter";

/** Action category grouping. */
export type ActionCategory = "people" | "messaging" | "engagement" | "crm" | "workflow";

/** Schema for a single configuration field. */
export interface ConfigFieldSchema {
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  description: string;
  default?: unknown;
}

/** Metadata about a single action type. */
export interface ActionTypeInfo {
  name: ActionType;
  description: string;
  category: ActionCategory;
  configSchema: Record<string, ConfigFieldSchema>;
  example?: Record<string, unknown>;
}

/** Return type for catalog queries. */
export interface ActionTypeCatalog {
  actionTypes: ActionTypeInfo[];
}

const ACTION_TYPE_INFOS: ActionTypeInfo[] = [
  {
    name: "VisitAndExtract",
    description: "Visit a LinkedIn profile and extract data (name, positions, education, skills).",
    category: "people",
    configSchema: {
      extractProfile: {
        type: "boolean",
        required: false,
        description: "Whether to extract full profile data after visiting.",
        default: true,
      },
    },
    example: { extractProfile: true },
  },
  {
    name: "MessageToPerson",
    description: "Send a direct message to a 1st-degree connection.",
    category: "messaging",
    configSchema: {
      messageTemplate: {
        type: "object",
        required: true,
        description:
          "Message template with variable substitution support (e.g., {firstName}).",
      },
      subjectTemplate: {
        type: "object",
        required: false,
        description: "Optional subject line template for the message.",
      },
      rejectIfReplied: {
        type: "boolean",
        required: false,
        description: "Skip person if they already replied in this campaign.",
        default: false,
      },
      rejectIfMessaged: {
        type: "boolean",
        required: false,
        description: "Skip person if a message was already sent to them.",
        default: false,
      },
      rejectIfRepliedWithinCampaign: {
        type: "boolean",
        required: false,
        description:
          "Skip person if they replied within the current campaign.",
        default: false,
      },
      rejectIfMessagedAfterPreviousCampaignMessage: {
        type: "boolean",
        required: false,
        description:
          "Skip person if they were messaged after a previous campaign message.",
        default: false,
      },
    },
    example: {
      messageTemplate: {
        type: "variants",
        variants: [
          {
            type: "variant",
            child: {
              type: "group",
              children: [
                { type: "text", value: "Hello " },
                { type: "var", name: "firstName" },
              ],
            },
          },
        ],
      },
      rejectIfReplied: false,
    },
  },
  {
    name: "InMail",
    description:
      "Send an InMail message to a LinkedIn member (does not require a connection).",
    category: "messaging",
    configSchema: {
      messageTemplate: {
        type: "object",
        required: true,
        description:
          "InMail body template with variable substitution support.",
      },
      subjectTemplate: {
        type: "object",
        required: false,
        description: "InMail subject line template.",
      },
      rejectIfReplied: {
        type: "boolean",
        required: false,
        description: "Skip person if they already replied.",
        default: false,
      },
    },
    example: {
      messageTemplate: {
        type: "variants",
        variants: [
          {
            type: "variant",
            child: { type: "text", value: "I would like to connect." },
          },
        ],
      },
    },
  },
  {
    name: "InvitePerson",
    description: "Send a connection request to a LinkedIn member.",
    category: "people",
    configSchema: {
      messageTemplate: {
        type: "object",
        required: false,
        description:
          "Optional invitation note template (max 300 characters).",
      },
    },
    example: {
      messageTemplate: {
        type: "variants",
        variants: [
          {
            type: "variant",
            child: {
              type: "group",
              children: [
                { type: "text", value: "Hi " },
                { type: "var", name: "firstName" },
                {
                  type: "text",
                  value: ", I'd like to add you to my network.",
                },
              ],
            },
          },
        ],
      },
    },
  },
  {
    name: "Follow",
    description: "Follow or unfollow a LinkedIn profile.",
    category: "engagement",
    configSchema: {
      unfollow: {
        type: "boolean",
        required: false,
        description: "If true, unfollow instead of follow.",
        default: false,
      },
    },
    example: { unfollow: false },
  },
  {
    name: "EndorseSkills",
    description: "Endorse skills listed on a LinkedIn profile.",
    category: "engagement",
    configSchema: {
      maxSkills: {
        type: "number",
        required: false,
        description: "Maximum number of skills to endorse.",
      },
    },
  },
  {
    name: "CheckForReplies",
    description: "Check for new message replies from contacts in the campaign.",
    category: "messaging",
    configSchema: {
      moveToSuccessfulAfterMs: {
        type: "number",
        required: true,
        description:
          "Auto-mark as successful after N milliseconds without a reply (null = never).",
      },
      treatMessageAcceptedAsReply: {
        type: "boolean",
        required: false,
        description: "Count message acceptance as a reply.",
      },
      keepInQueueIfRequestIsNotAccepted: {
        type: "boolean",
        required: false,
        description:
          "Keep checking if the connection request has not yet been accepted.",
      },
    },
    example: {
      moveToSuccessfulAfterMs: 86400000,
      treatMessageAcceptedAsReply: false,
      keepInQueueIfRequestIsNotAccepted: true,
    },
  },
  {
    name: "ScrapeMessagingHistory",
    description: "Scrape all messaging history for the LinkedIn account.",
    category: "messaging",
    configSchema: {},
  },
  {
    name: "Waiter",
    description:
      "Pause the campaign pipeline for a configured delay before proceeding to the next action.",
    category: "workflow",
    configSchema: {
      delay: {
        type: "number",
        required: true,
        description: "Delay in hours before proceeding to the next action.",
      },
    },
    example: { delay: 24 },
  },
  {
    name: "DataEnrichment",
    description:
      "Enrich profile data by extracting additional information from LinkedIn.",
    category: "crm",
    configSchema: {
      profileInfo: {
        type: "object",
        required: true,
        description:
          "Enrich profile info ({shouldEnrich: boolean, actualDate?: number}).",
      },
      phones: {
        type: "object",
        required: true,
        description:
          "Enrich phone numbers ({shouldEnrich: boolean, actualDate?: number}).",
      },
      emails: {
        type: "object",
        required: true,
        description:
          'Enrich email addresses ({shouldEnrich: boolean, actualDate?: number, types: ["personal","business"]}).',
      },
      socials: {
        type: "object",
        required: true,
        description:
          "Enrich social profiles ({shouldEnrich: boolean, actualDate?: number}).",
      },
      companies: {
        type: "object",
        required: true,
        description:
          "Enrich company data ({shouldEnrich: boolean, actualDate?: number}).",
      },
      actualDate: {
        type: "number",
        required: false,
        description:
          "Only enrich data newer than this timestamp (min 0).",
      },
    },
    example: {
      profileInfo: { shouldEnrich: false },
      phones: { shouldEnrich: false },
      emails: { shouldEnrich: false, types: ["personal", "business"] },
      socials: { shouldEnrich: false },
      companies: { shouldEnrich: true },
    },
  },
  {
    name: "PersonPostsLiker",
    description: "Like recent posts published by a LinkedIn profile.",
    category: "engagement",
    configSchema: {
      maxPosts: {
        type: "number",
        required: false,
        description: "Maximum number of recent posts to like.",
      },
    },
  },
  {
    name: "RemoveFromFirstConnection",
    description: "Remove a person from 1st-degree connections (unfriend).",
    category: "people",
    configSchema: {},
  },
  {
    name: "FilterContactsOutOfMyNetwork",
    description:
      "Filter out contacts who are no longer in your network (e.g., withdrawn invitations, removed connections).",
    category: "crm",
    configSchema: {
      maxScrollDepth: {
        type: "number",
        required: false,
        description: "Maximum scroll depth when browsing connections (min 0).",
      },
      checkUntil: {
        type: "string",
        required: false,
        description:
          'When to stop checking — "PreviouslyFound" or "FirstInviteDate".',
      },
      launchAutoAcceptInvites: {
        type: "boolean",
        required: false,
        description: "Auto-accept pending invitations.",
      },
      launchAutoCancelInvites: {
        type: "boolean",
        required: false,
        description: "Auto-cancel old pending invitations.",
      },
      cancelInvitesOlderThan: {
        type: "number",
        required: false,
        description:
          "Cancel invites older than N milliseconds (required when launchAutoCancelInvites is true, min 1).",
      },
    },
    example: {
      maxScrollDepth: 200,
      checkUntil: "PreviouslyFound",
      cancelInvitesOlderThan: 2592000000,
      launchAutoAcceptInvites: false,
      launchAutoCancelInvites: true,
    },
  },
];

/** Deep-freeze an object and all nested objects. */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return Object.freeze(obj);
}

// Freeze all catalog entries so consumers cannot mutate the shared static data.
for (const info of ACTION_TYPE_INFOS) {
  deepFreeze(info);
}

/** Map for O(1) lookup by action type name. */
const ACTION_TYPE_MAP = new Map<ActionType, Readonly<ActionTypeInfo>>(
  ACTION_TYPE_INFOS.map((info) => [info.name, info]),
);

/**
 * Get the action types catalog, optionally filtered by category.
 */
export function getActionTypeCatalog(category?: ActionCategory): ActionTypeCatalog {
  if (category === undefined) {
    return { actionTypes: [...ACTION_TYPE_INFOS] };
  }

  return {
    actionTypes: ACTION_TYPE_INFOS.filter((info) => info.category === category),
  };
}

/**
 * Get metadata for a single action type.
 *
 * @returns The action type info, or `undefined` if the type is unknown.
 */
export function getActionTypeInfo(
  actionType: ActionType,
): Readonly<ActionTypeInfo>;
export function getActionTypeInfo(
  actionType: string,
): Readonly<ActionTypeInfo> | undefined;
export function getActionTypeInfo(
  actionType: string,
): Readonly<ActionTypeInfo> | undefined {
  return ACTION_TYPE_MAP.get(actionType as ActionType);
}
