// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

/**
 * Escapes SQL LIKE wildcard characters (`%` and `_`) in user input
 * so they are treated as literals.
 *
 * Must be used with `ESCAPE '\'` in the LIKE clause.
 */
export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}
