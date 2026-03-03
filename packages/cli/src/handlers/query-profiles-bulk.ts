// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  type Profile,
  DatabaseClient,
  discoverAllDatabases,
  errorMessage,
  ProfileRepository,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#profiles--messaging | query-profiles-bulk} CLI command. */
export async function handleQueryProfilesBulk(options: {
  personId?: number[];
  publicId?: string[];
  includePositions?: boolean;
  json?: boolean;
}): Promise<void> {
  const personIds = options.personId ?? [];
  const publicIds = options.publicId ?? [];

  if (personIds.length === 0 && publicIds.length === 0) {
    process.stderr.write(
      "At least one --person-id or --public-id must be provided.\n",
    );
    process.exitCode = 1;
    return;
  }

  const databases = discoverAllDatabases();
  if (databases.size === 0) {
    process.stderr.write("No LinkedHelper databases found.\n");
    process.exitCode = 1;
    return;
  }

  const findOptions = { includePositions: options.includePositions === true };

  const byPersonId = new Map<number, Profile>();
  const byPublicId = new Map<string, Profile>();

  for (const [, dbPath] of databases) {
    const db = new DatabaseClient(dbPath);
    try {
      const repo = new ProfileRepository(db);

      if (personIds.length > 0) {
        const remaining = personIds.filter((id) => !byPersonId.has(id));
        if (remaining.length > 0) {
          const results = repo.findByIds(remaining, findOptions);
          for (const [i, id] of remaining.entries()) {
            const profile = results[i];
            if (profile != null) {
              byPersonId.set(id, profile);
            }
          }
        }
      }

      if (publicIds.length > 0) {
        const remaining = publicIds.filter((s) => !byPublicId.has(s));
        if (remaining.length > 0) {
          const results = repo.findByPublicIds(remaining, findOptions);
          for (const [i, slug] of remaining.entries()) {
            const profile = results[i];
            if (profile != null) {
              byPublicId.set(slug, profile);
            }
          }
        }
      }
    } catch (error) {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    } finally {
      db.close();
    }
  }

  const result: {
    byPersonId?: (Profile | null)[];
    byPublicId?: (Profile | null)[];
  } = {};

  if (personIds.length > 0) {
    result.byPersonId = personIds.map((id) => byPersonId.get(id) ?? null);
  }
  if (publicIds.length > 0) {
    result.byPublicId = publicIds.map((s) => byPublicId.get(s) ?? null);
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const allProfiles: (Profile | null)[] = [
      ...(result.byPersonId ?? []),
      ...(result.byPublicId ?? []),
    ];

    const found = allProfiles.filter((p): p is Profile => p != null);
    const notFound = allProfiles.filter((p) => p == null).length;

    if (found.length === 0) {
      process.stderr.write("No profiles found.\n");
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      `Found ${String(found.length)} profile(s)` +
        (notFound > 0 ? `, ${String(notFound)} not found` : "") +
        ":\n\n",
    );

    for (const profile of found) {
      const name = [profile.miniProfile.firstName, profile.miniProfile.lastName]
        .filter(Boolean)
        .join(" ");

      let line = `#${String(profile.id)}  ${name}`;
      if (profile.currentPosition) {
        const parts = [
          profile.currentPosition.title,
          profile.currentPosition.company,
        ].filter(Boolean);
        if (parts.length > 0) {
          line += ` -- ${parts.join(" at ")}`;
        }
      } else if (profile.miniProfile.headline) {
        line += ` -- ${profile.miniProfile.headline}`;
      }
      process.stdout.write(`${line}\n`);
    }
  }
}
