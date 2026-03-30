// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  deleteCollection,
  errorMessage,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#delete-collection | delete-collection} CLI command. */
export async function handleDeleteCollection(
  collectionId: number,
  options: {
    cdpPort?: number;
    cdpHost?: string;
    allowRemote?: boolean;
    json?: boolean;
  },
): Promise<void> {
  try {
    const result = await deleteCollection({
      collectionId,
      cdpPort: options.cdpPort,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      if (result.deleted) {
        process.stdout.write(
          `Deleted collection #${String(collectionId)}.\n`,
        );
      } else {
        process.stdout.write(
          `Collection #${String(collectionId)} not found.\n`,
        );
      }
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
