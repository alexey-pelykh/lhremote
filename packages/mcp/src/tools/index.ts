// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerAddPeopleToCollection } from "./add-people-to-collection.js";
import { registerBuildLinkedInUrl } from "./build-linkedin-url.js";
import { registerCollectPeople } from "./collect-people.js";
import { registerCommentOnPost } from "./comment-on-post.js";
import { registerEndorseSkills } from "./endorse-skills.js";
import { registerEnrichProfile } from "./enrich-profile.js";
import { registerFollowPerson } from "./follow-person.js";
import { registerLikePersonPosts } from "./like-person-posts.js";
import { registerMessagePerson } from "./message-person.js";
import { registerRemoveConnection } from "./remove-connection.js";
import { registerSendInmail } from "./send-inmail.js";
import { registerSendInvite } from "./send-invite.js";
import { registerCampaignAddAction } from "./campaign-add-action.js";
import { registerCampaignCreate } from "./campaign-create.js";
import { registerCampaignDelete } from "./campaign-delete.js";
import { registerCampaignExcludeAdd } from "./campaign-exclude-add.js";
import { registerCampaignExcludeList } from "./campaign-exclude-list.js";
import { registerCampaignExcludeRemove } from "./campaign-exclude-remove.js";
import { registerCampaignExport } from "./campaign-export.js";
import { registerCampaignGet } from "./campaign-get.js";
import { registerCampaignList } from "./campaign-list.js";
import { registerCampaignListPeople } from "./campaign-list-people.js";
import { registerCampaignMoveNext } from "./campaign-move-next.js";
import { registerCampaignRemoveAction } from "./campaign-remove-action.js";
import { registerCampaignRemovePeople } from "./campaign-remove-people.js";
import { registerCampaignReorderActions } from "./campaign-reorder-actions.js";
import { registerCampaignRetry } from "./campaign-retry.js";
import { registerCampaignUpdateAction } from "./campaign-update-action.js";
import { registerImportPeopleFromUrls } from "./import-people-from-urls.js";
import { registerCampaignStart } from "./campaign-start.js";
import { registerCampaignStatistics } from "./campaign-statistics.js";
import { registerCampaignStatus } from "./campaign-status.js";
import { registerCampaignStop } from "./campaign-stop.js";
import { registerCampaignUpdate } from "./campaign-update.js";
import { registerCreateCollection } from "./create-collection.js";
import { registerDeleteCollection } from "./delete-collection.js";
import { registerCheckReplies } from "./check-replies.js";
import { registerCheckStatus } from "./check-status.js";
import { registerDescribeActions } from "./describe-actions.js";
import { registerFindApp } from "./find-app.js";
import { registerGetActionBudget } from "./get-action-budget.js";
import { registerGetPost } from "./get-post.js";
import { registerGetPostEngagers } from "./get-post-engagers.js";
import { registerGetPostStats } from "./get-post-stats.js";
import { registerGetFeed } from "./get-feed.js";
import { registerGetProfileActivity } from "./get-profile-activity.js";
import { registerGetErrors } from "./get-errors.js";
import { registerGetThrottleStatus } from "./get-throttle-status.js";
import { registerImportPeopleFromCollection } from "./import-people-from-collection.js";
import { registerListLinkedInReferenceData } from "./list-linkedin-reference-data.js";
import { registerLaunchApp } from "./launch-app.js";
import { registerListCollections } from "./list-collections.js";
import { registerListAccounts } from "./list-accounts.js";
import { registerQuitApp } from "./quit-app.js";
import { registerStartInstance } from "./start-instance.js";
import { registerStopInstance } from "./stop-instance.js";
import { registerQueryMessages } from "./query-messages.js";
import { registerRemovePeopleFromCollection } from "./remove-people-from-collection.js";
import { registerResolveLinkedInEntity } from "./resolve-linkedin-entity.js";
import { registerReactToPost } from "./react-to-post.js";
import { registerQueryProfile } from "./query-profile.js";
import { registerQueryProfiles } from "./query-profiles.js";
import { registerQueryProfilesBulk } from "./query-profiles-bulk.js";
import { registerScrapeMessagingHistory } from "./scrape-messaging-history.js";
import { registerSearchPosts } from "./search-posts.js";
import { registerVisitProfile } from "./visit-profile.js";

export {
  registerAddPeopleToCollection,
  registerBuildLinkedInUrl,
  registerCollectPeople,
  registerCommentOnPost,
  registerEndorseSkills,
  registerEnrichProfile,
  registerFollowPerson,
  registerLikePersonPosts,
  registerMessagePerson,
  registerRemoveConnection,
  registerSendInmail,
  registerSendInvite,
  registerCampaignAddAction,
  registerCampaignCreate,
  registerCampaignDelete,
  registerCampaignExcludeAdd,
  registerCampaignExcludeList,
  registerCampaignExcludeRemove,
  registerCampaignExport,
  registerCampaignGet,
  registerCampaignList,
  registerCampaignListPeople,
  registerCampaignMoveNext,
  registerCampaignRemoveAction,
  registerCampaignRemovePeople,
  registerCampaignReorderActions,
  registerCampaignRetry,
  registerCampaignUpdateAction,
  registerCampaignStart,
  registerCampaignStatistics,
  registerCampaignStatus,
  registerCampaignStop,
  registerCampaignUpdate,
  registerCreateCollection,
  registerDeleteCollection,
  registerCheckReplies,
  registerCheckStatus,
  registerDescribeActions,
  registerFindApp,
  registerGetActionBudget,
  registerGetFeed,
  registerGetPost,
  registerGetPostEngagers,
  registerGetPostStats,
  registerGetProfileActivity,
  registerGetErrors,
  registerGetThrottleStatus,
  registerImportPeopleFromCollection,
  registerImportPeopleFromUrls,
  registerLaunchApp,
  registerListCollections,
  registerListAccounts,
  registerListLinkedInReferenceData,
  registerQueryMessages,
  registerRemovePeopleFromCollection,
  registerQueryProfile,
  registerQueryProfiles,
  registerQueryProfilesBulk,
  registerQuitApp,
  registerReactToPost,
  registerResolveLinkedInEntity,
  registerScrapeMessagingHistory,
  registerSearchPosts,
  registerStartInstance,
  registerStopInstance,
  registerVisitProfile,
};

export function registerAllTools(server: McpServer): void {
  registerAddPeopleToCollection(server);
  registerCommentOnPost(server);
  registerCampaignAddAction(server);
  registerCampaignCreate(server);
  registerCampaignDelete(server);
  registerCampaignExcludeAdd(server);
  registerCampaignExcludeList(server);
  registerCampaignExcludeRemove(server);
  registerCampaignExport(server);
  registerCampaignGet(server);
  registerCampaignList(server);
  registerCampaignListPeople(server);
  registerCampaignMoveNext(server);
  registerCampaignRemoveAction(server);
  registerCampaignRemovePeople(server);
  registerCampaignReorderActions(server);
  registerCampaignRetry(server);
  registerCampaignStart(server);
  registerCampaignStatistics(server);
  registerCampaignStatus(server);
  registerCampaignStop(server);
  registerCampaignUpdate(server);
  registerCampaignUpdateAction(server);
  registerFindApp(server);
  registerGetActionBudget(server);
  registerGetFeed(server);
  registerGetPost(server);
  registerGetPostEngagers(server);
  registerGetPostStats(server);
  registerGetProfileActivity(server);
  registerGetErrors(server);
  registerGetThrottleStatus(server);
  registerLaunchApp(server);
  registerQuitApp(server);
  registerListAccounts(server);
  registerStartInstance(server);
  registerStopInstance(server);
  registerQueryMessages(server);
  registerQueryProfile(server);
  registerQueryProfiles(server);
  registerQueryProfilesBulk(server);
  registerReactToPost(server);
  registerScrapeMessagingHistory(server);
  registerSearchPosts(server);
  registerCreateCollection(server);
  registerDeleteCollection(server);
  registerCheckReplies(server);
  registerCheckStatus(server);
  registerCollectPeople(server);
  registerDescribeActions(server);
  registerImportPeopleFromCollection(server);
  registerImportPeopleFromUrls(server);
  registerListCollections(server);
  registerListLinkedInReferenceData(server);
  registerRemovePeopleFromCollection(server);
  registerBuildLinkedInUrl(server);
  registerResolveLinkedInEntity(server);
  registerVisitProfile(server);
  registerEndorseSkills(server);
  registerEnrichProfile(server);
  registerFollowPerson(server);
  registerLikePersonPosts(server);
  registerMessagePerson(server);
  registerRemoveConnection(server);
  registerSendInmail(server);
  registerSendInvite(server);
}
