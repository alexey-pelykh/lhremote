// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

export { buildCdpOptions, type ConnectionOptions } from "./types.js";

// Campaign CRUD
export {
  campaignGet,
  type CampaignGetInput,
  type CampaignGetOutput,
} from "./campaign-get.js";
export {
  campaignList,
  type CampaignListInput,
  type CampaignListOutput,
} from "./campaign-list.js";
export {
  campaignCreate,
  type CampaignCreateInput,
  type CampaignCreateOutput,
} from "./campaign-create.js";
export {
  campaignUpdate,
  type CampaignUpdateInput,
  type CampaignUpdateOutput,
} from "./campaign-update.js";
export {
  campaignDelete,
  type CampaignDeleteInput,
  type CampaignDeleteOutput,
} from "./campaign-delete.js";
export {
  campaignErase,
  type CampaignEraseInput,
  type CampaignEraseOutput,
} from "./campaign-erase.js";

// Campaign people
export {
  campaignListPeople,
  type CampaignListPeopleInput,
  type CampaignListPeopleOutput,
} from "./campaign-list-people.js";

// Campaign execution
export {
  campaignStart,
  type CampaignStartInput,
  type CampaignStartOutput,
} from "./campaign-start.js";
export {
  campaignStop,
  type CampaignStopInput,
  type CampaignStopOutput,
} from "./campaign-stop.js";
export {
  campaignRetry,
  type CampaignRetryInput,
  type CampaignRetryOutput,
} from "./campaign-retry.js";
export {
  campaignMoveNext,
  type CampaignMoveNextInput,
  type CampaignMoveNextOutput,
} from "./campaign-move-next.js";
export {
  campaignStatistics,
  type CampaignStatisticsInput,
  type CampaignStatisticsOutput,
} from "./campaign-statistics.js";
export {
  campaignStatus,
  type CampaignStatusInput,
  type CampaignStatusOutput,
} from "./campaign-status.js";

// Campaign configuration
export {
  campaignAddAction,
  type CampaignAddActionInput,
  type CampaignAddActionOutput,
} from "./campaign-add-action.js";
export {
  campaignRemoveAction,
  type CampaignRemoveActionInput,
  type CampaignRemoveActionOutput,
} from "./campaign-remove-action.js";
export {
  campaignUpdateAction,
  type CampaignUpdateActionInput,
  type CampaignUpdateActionOutput,
} from "./campaign-update-action.js";
export {
  campaignReorderActions,
  type CampaignReorderActionsInput,
  type CampaignReorderActionsOutput,
} from "./campaign-reorder-actions.js";
export {
  campaignExport,
  type CampaignExportInput,
  type CampaignExportOutput,
} from "./campaign-export.js";

// Exclude list
export {
  campaignExcludeAdd,
  type CampaignExcludeAddInput,
  type CampaignExcludeAddOutput,
} from "./campaign-exclude-add.js";
export {
  campaignExcludeRemove,
  type CampaignExcludeRemoveInput,
  type CampaignExcludeRemoveOutput,
} from "./campaign-exclude-remove.js";
export {
  campaignExcludeList,
  type CampaignExcludeListInput,
  type CampaignExcludeListOutput,
} from "./campaign-exclude-list.js";

// Error detection
export {
  getErrors,
  type GetErrorsInput,
  type GetErrorsOutput,
} from "./get-errors.js";
export {
  dismissErrors,
  type DismissErrorsInput,
  type DismissErrorsOutput,
} from "./dismiss-errors.js";

// Messaging
export {
  queryMessages,
  type QueryMessagesInput,
  type QueryMessagesOutput,
} from "./query-messages.js";
export {
  checkReplies,
  type CheckRepliesInput,
  type CheckRepliesOutput,
} from "./check-replies.js";
export {
  scrapeMessagingHistory,
  type ScrapeMessagingHistoryInput,
  type ScrapeMessagingHistoryOutput,
} from "./scrape-messaging-history.js";
export {
  IMPORT_CHUNK_SIZE,
  importPeopleFromUrls,
  type ImportPeopleFromUrlsInput,
  type ImportPeopleFromUrlsOutput,
} from "./import-people-from-urls.js";
export {
  campaignRemovePeople,
  type CampaignRemovePeopleInput,
  type CampaignRemovePeopleOutput,
} from "./campaign-remove-people.js";

// People collection
export {
  collectPeople,
  type CollectPeopleInput,
  type CollectPeopleOutput,
} from "./collect-people.js";

// Collections (Lists)
export {
  listCollections,
  type ListCollectionsInput,
  type ListCollectionsOutput,
} from "./list-collections.js";
export {
  createCollection,
  type CreateCollectionInput,
  type CreateCollectionOutput,
} from "./create-collection.js";
export {
  deleteCollection,
  type DeleteCollectionInput,
  type DeleteCollectionOutput,
} from "./delete-collection.js";
export {
  addPeopleToCollection,
  type AddPeopleToCollectionInput,
  type AddPeopleToCollectionOutput,
} from "./add-people-to-collection.js";
export {
  removePeopleFromCollection,
  type RemovePeopleFromCollectionInput,
  type RemovePeopleFromCollectionOutput,
} from "./remove-people-from-collection.js";
export {
  importPeopleFromCollection,
  type ImportPeopleFromCollectionInput,
  type ImportPeopleFromCollectionOutput,
} from "./import-people-from-collection.js";

// Post interaction
export {
  commentOnPost,
  type CommentOnPostInput,
  type CommentOnPostOutput,
} from "./comment-on-post.js";
export {
  dismissFeedPost,
  type DismissFeedPostInput,
  type DismissFeedPostOutput,
} from "./dismiss-feed-post.js";

// Post detail
export {
  getPost,
  type GetPostInput,
  type GetPostOutput,
} from "./get-post.js";

// Post analytics
export {
  getPostStats,
  extractPostUrn,
  resolvePostDetailUrl,
  type GetPostStatsInput,
  type GetPostStatsOutput,
} from "./get-post-stats.js";
export {
  getPostEngagers,
  type GetPostEngagersInput,
  type GetPostEngagersOutput,
} from "./get-post-engagers.js";

// Post search
export {
  searchPosts,
  type SearchPostsInput,
  type SearchPostsOutput,
} from "./search-posts.js";

// Feed
export {
  getFeed,
  type GetFeedInput,
  type GetFeedOutput,
} from "./get-feed.js";
export {
  hideFeedAuthor,
  type HideFeedAuthorInput,
  type HideFeedAuthorOutput,
} from "./hide-feed-author.js";
export {
  hideFeedAuthorProfile,
  type HideFeedAuthorProfileInput,
  type HideFeedAuthorProfileOutput,
  type HideFeedAuthorProfileSkipReason,
} from "./hide-feed-author-profile.js";

// Profile activity
export {
  getProfileActivity,
  extractProfileId,
  type GetProfileActivityInput,
  type GetProfileActivityOutput,
} from "./get-profile-activity.js";

// Action budget & throttle status
export {
  getActionBudget,
  type GetActionBudgetInput,
  type GetActionBudgetOutput,
} from "./get-action-budget.js";
export {
  getThrottleStatus,
  type GetThrottleStatusInput,
  type GetThrottleStatusOutput,
} from "./get-throttle-status.js";

// Standalone actions
export {
  visitProfile,
  type VisitProfileInput,
  type VisitProfileOutput,
} from "./visit-profile.js";
export {
  buildCompanyUrl,
  buildProfileUrl,
  extractFollowableTarget,
  extractPublicId,
  LINKEDIN_COMPANY_RE,
  LINKEDIN_PROFILE_RE,
  navigateToCompany,
  navigateToProfile,
  type FollowableTarget,
} from "./navigate-to-profile.js";

// Post interaction
export {
  reactToPost,
  REACTION_TYPES,
  type ReactToPostInput,
  type ReactToPostOutput,
  type ReactionType,
} from "./react-to-post.js";
export {
  reactToComment,
  type ReactToCommentInput,
  type ReactToCommentOutput,
} from "./react-to-comment.js";
export {
  unfollowFromFeed,
  type UnfollowFromFeedInput,
  type UnfollowFromFeedOutput,
} from "./unfollow-from-feed.js";
export {
  unfollowProfile,
  type UnfollowProfileInput,
  type UnfollowProfileOutput,
  type UnfollowProfilePriorState,
} from "./unfollow-profile.js";

// Individual actions (ephemeral campaign)
export {
  type EphemeralActionInput,
} from "./ephemeral-action.js";
export {
  messagePerson,
  type MessagePersonInput,
  type MessagePersonOutput,
} from "./message-person.js";
export {
  sendInvite,
  type SendInviteInput,
  type SendInviteOutput,
} from "./send-invite.js";
export {
  sendInmail,
  type SendInmailInput,
  type SendInmailOutput,
} from "./send-inmail.js";
export {
  followPerson,
  type FollowPersonInput,
  type FollowPersonOutput,
} from "./follow-person.js";
export {
  endorseSkills,
  type EndorseSkillsInput,
  type EndorseSkillsOutput,
} from "./endorse-skills.js";
export {
  likePersonPosts,
  type LikePersonPostsInput,
  type LikePersonPostsOutput,
} from "./like-person-posts.js";
export {
  removeConnection,
  type RemoveConnectionInput,
  type RemoveConnectionOutput,
} from "./remove-connection.js";
export {
  enrichProfile,
  type EnrichProfileInput,
  type EnrichProfileOutput,
  type EnrichmentCategory,
} from "./enrich-profile.js";

// URL building & entity resolution
export {
  buildLinkedInUrl,
  type BuildLinkedInUrlInput,
  type BuildLinkedInUrlOutput,
} from "./build-linkedin-url.js";
export {
  resolveLinkedInEntity,
  type ResolveLinkedInEntityInput,
  type ResolveLinkedInEntityOutput,
} from "./resolve-linkedin-entity.js";
