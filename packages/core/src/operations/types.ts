// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

/**
 * Connection options shared by all operations that need to reach a
 * running LinkedHelper instance via CDP.
 */
export interface ConnectionOptions {
  readonly cdpPort: number;
  readonly cdpHost?: string | undefined;
  readonly allowRemote?: boolean | undefined;
}
