// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

export type {
  ActionCategory,
  ActionType,
  ActionTypeCatalog,
  ActionTypeInfo,
  ConfigFieldSchema,
} from "./action-types.js";

export {
  getActionTypeCatalog,
  getActionTypeInfo,
  validateActionSettings,
  type ActionSettingsValidationIssue,
  type ActionSettingsValidationResult,
} from "./action-types.js";

export {
  getFunctionById,
  getIndustryById,
  getLinkedInReferenceData,
  getSeniorityById,
  isReferenceDataType,
} from "./linkedin-reference.js";
