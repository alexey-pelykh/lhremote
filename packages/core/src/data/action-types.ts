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
      extractCurrentOrganizations: {
        type: "boolean",
        required: false,
        description: "Extract current company info during profile visit.",
      },
    },
    example: { extractCurrentOrganizations: true },
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
      textInputMethod: {
        type: "string",
        required: false,
        description:
          'How to input text — "insert", "type", or "random".',
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
      rejectIfRepliedWithinCampaign: {
        type: "boolean",
        required: false,
        description: "Skip if person replied within this campaign.",
      },
      proceedOnOutOfCredits: {
        type: "boolean",
        required: false,
        description:
          "Continue processing even when InMail credits are exhausted.",
      },
      textInputMethod: {
        type: "string",
        required: false,
        description:
          'How to input text — "insert", "type", or "random".',
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
                { type: "text", value: ", message body here" },
              ],
            },
          },
        ],
      },
      subjectTemplate: {
        type: "group",
        children: [
          { type: "text", value: "Subject line here" },
        ],
      },
      rejectIfRepliedWithinCampaign: false,
    },
  },
  {
    name: "InvitePerson",
    description: "Send a connection request to a LinkedIn member.",
    category: "people",
    configSchema: {
      messageTemplate: {
        type: "object",
        required: true,
        description:
          "Invitation message template with variable substitution (can be empty for no message).",
      },
      saveAsLeadSN: {
        type: "boolean",
        required: true,
        description: "Save as lead in Sales Navigator.",
      },
      emailCustomFieldName: {
        type: "string",
        required: false,
        description: "Custom field name for email (null if not used).",
      },
      textInputMethod: {
        type: "string",
        required: false,
        description:
          'How to input text — "insert", "type", or "random".',
      },
      goOverWeeklyInvitationLimit: {
        type: "boolean",
        required: false,
        description:
          "Continue sending invitations even if the weekly invite limit is reached.",
      },
      extractEmailFromPAS: {
        type: "boolean",
        required: false,
        description:
          "Extract email from the People Also Searched section.",
      },
      invitePersonByEmail: {
        type: "boolean",
        required: false,
        description: "Invite by email instead of LinkedIn.",
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
      saveAsLeadSN: false,
      extractEmailFromPAS: true,
      emailCustomFieldName: null,
    },
  },
  {
    name: "Follow",
    description: "Follow or unfollow a LinkedIn profile.",
    category: "engagement",
    configSchema: {
      mode: {
        type: "string",
        required: false,
        description:
          'Follow or unfollow the person. Must be "follow" or "unfollow" (default: follow).',
        default: "follow",
      },
      skipIfUnfollowable: {
        type: "boolean",
        required: true,
        description: "Skip if person can't be unfollowed.",
      },
    },
    example: { mode: "follow", skipIfUnfollowable: true },
  },
  {
    name: "EndorseSkills",
    description: "Endorse skills listed on a LinkedIn profile.",
    category: "engagement",
    configSchema: {
      skillNames: {
        type: "array",
        required: false,
        description:
          "Specific skill names to endorse (mutually exclusive with limit).",
      },
      limit: {
        type: "number",
        required: false,
        description:
          "Max number of skills to endorse (mutually exclusive with skillNames).",
      },
      skipIfNotEndorsable: {
        type: "boolean",
        required: true,
        description: "Skip if person has no endorsable skills.",
      },
    },
    example: { limit: 3, skipIfNotEndorsable: true },
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
    configSchema: {
      delays: {
        type: "object",
        required: false,
        description:
          "Per-step delay overrides (typePersonFullName, selectFoundPerson, sleepAfterScrollChatHistory, navigateToMessagingPage, navigateToProfile).",
      },
    },
    example: {},
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
        description: "Delay in hours before proceeding to the next action (min 0).",
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
    description: "Like and comment on posts and articles by a LinkedIn profile.",
    category: "engagement",
    configSchema: {
      numberOfArticles: {
        type: "number",
        required: false,
        description:
          "Number of articles to like. At least one of numberOfArticles or numberOfPosts must be > 0.",
      },
      numberOfPosts: {
        type: "number",
        required: false,
        description:
          "Number of posts to like. At least one of numberOfArticles or numberOfPosts must be > 0.",
      },
      maxAgeOfArticles: {
        type: "number",
        required: false,
        description: "Maximum age of articles in days (min 0).",
      },
      maxAgeOfPosts: {
        type: "number",
        required: false,
        description: "Maximum age of posts in days (min 0).",
      },
      textInputMethod: {
        type: "string",
        required: false,
        description:
          'How to input comment text — "insert", "type", or "random".',
      },
      skipIfNotLiked: {
        type: "boolean",
        required: true,
        description: "Skip if nothing was liked.",
      },
      shouldAddComment: {
        type: "boolean",
        required: false,
        description: "Also add a comment to liked posts/articles.",
      },
      messageTemplate: {
        type: "object",
        required: false,
        description:
          "Comment text template (required when shouldAddComment is true). Uses variable substitution.",
      },
    },
    example: {
      numberOfArticles: 2,
      numberOfPosts: 2,
      messageTemplate: {
        type: "variants",
        variants: [
          {
            type: "variant",
            child: {
              type: "group",
              children: [
                { type: "var", name: "firstName" },
                { type: "text", value: ", thanks for sharing!" },
              ],
            },
          },
        ],
      },
      skipIfNotLiked: true,
    },
  },
  {
    name: "RemoveFromFirstConnection",
    description: "Remove a person from 1st-degree connections (unfriend).",
    category: "people",
    configSchema: {
      delays: {
        type: "object",
        required: false,
        description:
          "Per-step delay overrides (navigateToProfile, clickOnMoreButton, clickOnRemoveConnectionButton).",
      },
    },
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
