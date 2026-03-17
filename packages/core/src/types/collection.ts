// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * LinkedIn source page types supported by LinkedHelper.
 *
 * Each source type corresponds to a specific LinkedIn page from which
 * people can be collected into campaigns.
 */
export type SourceType =
  | "SearchPage"
  | "MyConnections"
  | "Alumni"
  | "OrganizationPeople"
  | "Group"
  | "Event"
  | "LWVYPP"
  | "SentInvitationPage"
  | "FollowersPage"
  | "FollowingPage"
  | "SNSearchPage"
  | "SNListPage"
  | "SNOrgsPage"
  | "SNOrgsListsPage"
  | "TSearchPage"
  | "TProjectPage"
  | "RSearchPage"
  | "RProjectPage";

/**
 * LinkedIn product tier for a source type.
 */
export type SourceTier = "Free" | "SalesNavigator" | "Recruiter";
