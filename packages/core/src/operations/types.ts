// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Connection options shared by all operations that need to reach a
 * running LinkedHelper instance via CDP.
 *
 * When {@link cdpPort} is omitted, the appropriate port is
 * auto-discovered from running LinkedHelper processes.
 */
export interface ConnectionOptions {
  readonly cdpPort?: number | undefined;
  readonly cdpHost?: string | undefined;
  readonly allowRemote?: boolean | undefined;
}
