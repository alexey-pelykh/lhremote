import {
  type Account,
  DatabaseClient,
  discoverDatabase,
  discoverInstancePort,
  InstanceService,
  LauncherService,
  ProfileService,
} from "@lhremote/core";

export async function handleVisitAndExtract(
  profileUrl: string,
  options: { cdpPort?: number; pollTimeout?: number; json?: boolean },
): Promise<void> {
  if (!isLinkedInProfileUrl(profileUrl)) {
    process.stderr.write(
      "Invalid LinkedIn profile URL. Expected: https://www.linkedin.com/in/username\n",
    );
    process.exitCode = 1;
    return;
  }

  const cdpPort = options.cdpPort ?? 9222;

  // Connect to launcher to find the running account
  const launcher = new LauncherService(cdpPort);

  let accountId: number;
  try {
    await launcher.connect();
    const accounts = await launcher.listAccounts();
    if (accounts.length === 0) {
      process.stderr.write("No accounts found.\n");
      process.exitCode = 1;
      return;
    }
    if (accounts.length > 1) {
      process.stderr.write(
        "Multiple accounts found. Cannot determine which instance to use.\n",
      );
      process.exitCode = 1;
      return;
    }
    accountId = (accounts[0] as Account).id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  } finally {
    launcher.disconnect();
  }

  // Discover instance CDP port
  const instancePort = await discoverInstancePort(cdpPort);
  if (instancePort === null) {
    process.stderr.write(
      "No LinkedHelper instance is running. Use start-instance first.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Connect to instance and extract profile
  const instance = new InstanceService(instancePort);
  let db: DatabaseClient | null = null;

  try {
    await instance.connect();

    const dbPath = discoverDatabase(accountId);
    db = new DatabaseClient(dbPath);

    const profileService = new ProfileService(instance, db);
    const profile = await profileService.visitAndExtract(profileUrl, {
      ...(options.pollTimeout !== undefined && {
        pollTimeout: options.pollTimeout,
      }),
    });

    if (options.json) {
      process.stdout.write(JSON.stringify(profile, null, 2) + "\n");
    } else {
      const name = [
        profile.miniProfile.firstName,
        profile.miniProfile.lastName,
      ]
        .filter(Boolean)
        .join(" ");

      process.stdout.write(`${name}\n`);

      if (profile.miniProfile.headline) {
        process.stdout.write(`${profile.miniProfile.headline}\n`);
      }

      if (profile.currentPosition) {
        const parts = [
          profile.currentPosition.title,
          profile.currentPosition.company,
        ].filter(Boolean);
        if (parts.length > 0) {
          process.stdout.write(`${parts.join(" at ")}\n`);
        }
      }

      if (profile.emails.length > 0) {
        process.stdout.write(
          `Emails: ${profile.emails.join(", ")}\n`,
        );
      }

      if (profile.skills.length > 0) {
        process.stdout.write(
          `Skills: ${profile.skills.map((s) => s.name).join(", ")}\n`,
        );
      }

      process.stdout.write(
        `Positions: ${String(profile.positions.length)}, Education: ${String(profile.education.length)}\n`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    instance.disconnect();
    db?.close();
  }
}

function isLinkedInProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "www.linkedin.com" ||
        parsed.hostname === "linkedin.com") &&
      parsed.pathname.startsWith("/in/")
    );
  } catch {
    return false;
  }
}
