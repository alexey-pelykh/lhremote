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
  ProfileFindOptions,
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

export type { SourceTier, SourceType } from "./collection.js";

export type {
  BasicSearchParams,
  BooleanExpressionInput,
  BooleanExpressionRaw,
  BooleanExpressionStructured,
  CompanySizeEntry,
  ConnectionDegreeEntry,
  EntityMatch,
  EntityType,
  FunctionEntry,
  IndustryEntry,
  ProfileLanguageEntry,
  ReferenceDataType,
  SNFilter,
  SNFilterValue,
  SNSearchParams,
  SeniorityEntry,
  UrlBuilderResult,
} from "./linkedin-url.js";

export type {
  ActionConfig,
  ActionErrorSummary,
  ActionPeopleCounts,
  ActionStatistics,
  CampaignActionConfig,
  CampaignActionResult,
  CampaignActionUpdateConfig,
  ActionSettings,
  ActionTargetPerson,
  Campaign,
  CampaignAction,
  CampaignConfig,
  CampaignPersonEntry,
  CampaignPersonState,
  CampaignRunResult,
  CampaignState,
  ResultProfileData,
  CampaignStatistics,
  CampaignUpdateConfig,
  ExcludeListEntry,
  GetResultsOptions,
  GetStatisticsOptions,
  ImportPeopleResult,
  RemovePeopleResult,
  CampaignStatus,
  CampaignSummary,
  ListCampaignPeopleOptions,
  ListCampaignsOptions,
  RunnerState,
} from "./campaign.js";
