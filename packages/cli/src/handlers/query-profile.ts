import {
  type Profile,
  DatabaseClient,
  discoverAllDatabases,
  errorMessage,
  ProfileNotFoundError,
  ProfileRepository,
} from "@lhremote/core";

export async function handleQueryProfile(options: {
  personId?: number;
  publicId?: string;
  json?: boolean;
}): Promise<void> {
  const { personId, publicId } = options;

  if ((personId == null) === (publicId == null)) {
    process.stderr.write(
      "Exactly one of --person-id or --public-id must be provided.\n",
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

  let found: Profile | null = null;

  for (const [, dbPath] of databases) {
    const db = new DatabaseClient(dbPath);
    try {
      const repo = new ProfileRepository(db);
      found =
        personId != null
          ? repo.findById(personId)
          : repo.findByPublicId(publicId as string);
      break;
    } catch (error) {
      if (error instanceof ProfileNotFoundError) {
        continue;
      }
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    } finally {
      db.close();
    }
  }

  if (found == null) {
    process.stderr.write("Profile not found.\n");
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(found, null, 2) + "\n");
  } else {
    const name = [found.miniProfile.firstName, found.miniProfile.lastName]
      .filter(Boolean)
      .join(" ");

    process.stdout.write(`${name} (#${String(found.id)})\n`);

    if (found.miniProfile.headline) {
      process.stdout.write(`${found.miniProfile.headline}\n`);
    }

    if (found.currentPosition) {
      const parts = [
        found.currentPosition.title,
        found.currentPosition.company,
      ].filter(Boolean);
      if (parts.length > 0) {
        process.stdout.write(`\nCurrent: ${parts.join(" at ")}\n`);
      }
    }

    if (found.skills.length > 0) {
      process.stdout.write(
        `Skills: ${found.skills.map((s) => s.name).join(", ")}\n`,
      );
    }

    if (found.emails.length > 0) {
      process.stdout.write(`Email: ${found.emails.join(", ")}\n`);
    }

    const publicExtId = found.externalIds.find(
      (e) => e.typeGroup === "public",
    );
    if (publicExtId) {
      process.stdout.write(
        `\nLinkedIn: linkedin.com/in/${publicExtId.externalId}\n`,
      );
    }
  }
}
