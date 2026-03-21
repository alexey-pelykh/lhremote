// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { ActionSettings, EphemeralActionResult } from "../types/index.js";
import {
  executeEphemeralAction,
  type EphemeralActionInput,
} from "./ephemeral-action.js";

export interface LikePersonPostsInput extends EphemeralActionInput {
  readonly numberOfArticles?: number | undefined;
  readonly numberOfPosts?: number | undefined;
  readonly maxAgeOfArticles?: number | undefined;
  readonly maxAgeOfPosts?: number | undefined;
  readonly shouldAddComment?: boolean | undefined;
  readonly messageTemplate?: ActionSettings | undefined;
  readonly skipIfNotLiked?: boolean | undefined;
}

export type LikePersonPostsOutput = EphemeralActionResult;

export async function likePersonPosts(
  input: LikePersonPostsInput,
): Promise<LikePersonPostsOutput> {
  const actionSettings: ActionSettings = {
    skipIfNotLiked: input.skipIfNotLiked ?? true,
    ...(input.numberOfArticles !== undefined && {
      numberOfArticles: input.numberOfArticles,
    }),
    ...(input.numberOfPosts !== undefined && {
      numberOfPosts: input.numberOfPosts,
    }),
    ...(input.maxAgeOfArticles !== undefined && {
      maxAgeOfArticles: input.maxAgeOfArticles,
    }),
    ...(input.maxAgeOfPosts !== undefined && {
      maxAgeOfPosts: input.maxAgeOfPosts,
    }),
    ...(input.shouldAddComment !== undefined && {
      shouldAddComment: input.shouldAddComment,
    }),
    ...(input.messageTemplate !== undefined && {
      messageTemplate: input.messageTemplate,
    }),
  };

  return executeEphemeralAction("PersonPostsLiker", input, actionSettings);
}
