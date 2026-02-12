import {
  DatabaseClient,
  discoverAllDatabases,
  errorMessage,
  ProfileRepository,
  type ProfileSearchResult,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#profiles--messaging | query-profiles} CLI command. */
export async function handleQueryProfiles(options: {
  query?: string;
  company?: string;
  limit?: number;
  offset?: number;
  json?: boolean;
}): Promise<void> {
  const { query, company, limit = 20, offset = 0 } = options;

  const databases = discoverAllDatabases();
  if (databases.size === 0) {
    process.stderr.write("No LinkedHelper databases found.\n");
    process.exitCode = 1;
    return;
  }

  // Aggregate results from all databases
  const allProfiles: ProfileSearchResult["profiles"] = [];
  let totalCount = 0;

  for (const [, dbPath] of databases) {
    const db = new DatabaseClient(dbPath);
    try {
      const repo = new ProfileRepository(db);
      const result = repo.search({
        ...(query !== undefined && { query }),
        ...(company !== undefined && { company }),
        limit,
        offset,
      });
      allProfiles.push(...result.profiles);
      totalCount += result.total;
    } catch (error) {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    } finally {
      db.close();
    }
  }

  if (options.json) {
    const response = {
      profiles: allProfiles,
      total: totalCount,
      limit,
      offset,
    };
    process.stdout.write(JSON.stringify(response, null, 2) + "\n");
  } else {
    if (allProfiles.length === 0) {
      const criteria: string[] = [];
      if (query) criteria.push(`"${query}"`);
      if (company) criteria.push(`company "${company}"`);
      const desc = criteria.length > 0 ? criteria.join(", ") : "all";
      process.stdout.write(`No profiles found matching ${desc}.\n`);
      return;
    }

    const criteria: string[] = [];
    if (query) criteria.push(`"${query}"`);
    if (company) criteria.push(`company "${company}"`);
    const desc = criteria.length > 0 ? criteria.join(", ") : "all";
    process.stdout.write(
      `Profiles matching ${desc} (showing ${allProfiles.length} of ${totalCount}):\n\n`,
    );

    for (const profile of allProfiles) {
      const name = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .join(" ");
      const parts: string[] = [name];
      if (profile.title || profile.company) {
        const position = [profile.title, profile.company]
          .filter(Boolean)
          .join(" at ");
        parts.push(position);
      } else if (profile.headline) {
        parts.push(profile.headline);
      }
      process.stdout.write(`#${profile.id}  ${parts.join(" — ")}\n`);
    }
  }
}
