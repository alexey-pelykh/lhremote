// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Data for a dialog instance issue (requires user interaction to dismiss).
 */
export interface DialogIssueData {
  readonly id: string;
  readonly options: {
    readonly message: string;
    readonly controls: ReadonlyArray<{
      readonly id: string;
      readonly text: string;
    }>;
  };
}

/**
 * Data for a critical-error instance issue (informational, blocks the instance).
 */
export interface CriticalErrorIssueData {
  readonly message: string;
}

/**
 * An issue reported on a LinkedHelper instance.
 *
 * Dialog issues require a button selection to dismiss.
 * Critical-error issues are informational and block the instance.
 */
export type InstanceIssue =
  | { readonly type: "dialog"; readonly id: string; readonly data: DialogIssueData }
  | { readonly type: "critical-error"; readonly id: string; readonly data: CriticalErrorIssueData };

/**
 * State of a blocking popup overlay in the LinkedHelper launcher UI.
 *
 * Popups managed via `popupBS` BehaviorSubject in the frontend.
 * When a popup has `unclosable: true`, the user cannot dismiss it.
 */
export interface PopupState {
  /** Whether a blocking popup overlay is present. */
  readonly blocked: boolean;
  /** The popup message text, if available. */
  readonly message?: string;
  /** Whether the popup can be closed by the user. */
  readonly closable?: boolean;
}

/**
 * Aggregated UI health status for a LinkedHelper instance.
 */
export interface UIHealthStatus {
  /** Whether the UI is in a healthy (non-blocked) state. */
  readonly healthy: boolean;
  /** Active instance issues (dialogs and critical errors). */
  readonly issues: readonly InstanceIssue[];
  /** Current popup overlay state, or `null` if no popup is present. */
  readonly popup: PopupState | null;
}
