// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Base class for all format/validation errors.
 */
export class FormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FormatError";
  }
}
