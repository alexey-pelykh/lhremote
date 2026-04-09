// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

export {
  click,
  getElementCenter,
  hover,
  humanizedClick,
  humanizedHover,
  humanizedScrollY,
  type MentionEntry,
  scrollTo,
  typeText,
  typeTextWithMentions,
  type TypeMethod,
  waitForDOMStable,
  waitForElement,
  type WaitForElementOptions,
} from "./dom-automation.js";

export { HumanizedMouse } from "./humanized-mouse.js";

export {
  COMMENT_INPUT,
  COMMENT_SUBMIT_BUTTON,
  FEED_POST_CONTAINER,
  MENTION_OPTION,
  MENTION_TYPEAHEAD,
  REACTION_CELEBRATE,
  REACTION_FUNNY,
  REACTION_INSIGHTFUL,
  REACTION_LIKE,
  REACTION_LOVE,
  REACTION_SUPPORT,
  REACTION_TRIGGER,
  SELECTORS,
  type SelectorName,
} from "./selectors.js";
