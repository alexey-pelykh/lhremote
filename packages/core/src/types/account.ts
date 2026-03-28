// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * A LinkedHelper account.
 *
 * Each account corresponds to a LinkedIn identity managed by
 * LinkedHelper and has its own database partition.
 */
export interface Account {
  id: number;
  liId: number;
  name: string;
  email?: string | undefined;
}
