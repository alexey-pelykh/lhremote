// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

export type {
  CurrentPosition,
  Education,
  ExternalId,
  ExternalIdTypeGroup,
  MiniProfile,
  Position,
  Profile,
  ProfileSearchOptions,
  ProfileSearchResult,
  ProfileSummary,
  Skill,
} from "./profile.js";

export type {
  InstanceInfo,
  InstanceStatus,
  StartInstanceParams,
  StartInstanceResult,
} from "./instance.js";

export type { Account } from "./account.js";

export type {
  Chat,
  ChatParticipant,
  ConversationMessages,
  ConversationThread,
  Message,
  MessageStats,
  MessageSummary,
} from "./messaging.js";

export type {
  CriticalErrorIssueData,
  DialogIssueData,
  InstanceIssue,
  PopupState,
  UIHealthStatus,
} from "./ui-health.js";

export type {
  ActionConfig,
  ActionErrorSummary,
  ActionPeopleCounts,
  ActionStatistics,
  CampaignActionConfig,
  CampaignActionResult,
  ActionSettings,
  ActionTargetPerson,
  Campaign,
  CampaignAction,
  CampaignConfig,
  CampaignRunResult,
  CampaignState,
  CampaignStatistics,
  CampaignUpdateConfig,
  ExcludeListEntry,
  GetResultsOptions,
  GetStatisticsOptions,
  ImportPeopleResult,
  CampaignStatus,
  CampaignSummary,
  ListCampaignsOptions,
  RunnerState,
} from "./campaign.js";
