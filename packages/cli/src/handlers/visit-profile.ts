// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  type Profile,
  DEFAULT_CDP_PORT,
  errorMessage,
  InstanceNotRunningError,
  visitProfile,
  type VisitProfileOutput,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#visit-profile | visit-profile} CLI command. */
export async function handleVisitProfile(options: {
  personId?: number;
  url?: string;
  extractCurrentOrganizations?: boolean;
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  if ((options.personId == null) === (options.url == null)) {
    process.stderr.write(
      "Exactly one of --person-id or --url must be provided.\n",
    );
    process.exitCode = 1;
    return;
  }

  process.stderr.write("Visiting profile...\n");

  let result: VisitProfileOutput;
  try {
    result = await visitProfile({
      personId: options.personId,
      url: options.url,
      extractCurrentOrganizations: options.extractCurrentOrganizations,
      cdpPort: options.cdpPort ?? DEFAULT_CDP_PORT,
      cdpHost: options.cdpHost,
      allowRemote: options.allowRemote,
    });
  } catch (error) {
    if (error instanceof InstanceNotRunningError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      const message = errorMessage(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stderr.write("Done.\n");

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printProfile(result.profile);
  }
}

function printProfile(profile: Profile): void {
  const name = [profile.miniProfile.firstName, profile.miniProfile.lastName]
    .filter(Boolean)
    .join(" ");

  process.stdout.write(`${name} (#${String(profile.id)})\n`);

  if (profile.miniProfile.headline) {
    process.stdout.write(`${profile.miniProfile.headline}\n`);
  }

  if (profile.currentPosition) {
    const parts = [
      profile.currentPosition.title,
      profile.currentPosition.company,
    ].filter(Boolean);
    if (parts.length > 0) {
      process.stdout.write(`\nCurrent: ${parts.join(" at ")}\n`);
    }
  }

  if (profile.positions && profile.positions.length > 0) {
    process.stdout.write("\nPositions:\n");
    for (const pos of profile.positions) {
      const role = [pos.title, pos.company].filter(Boolean).join(" at ");
      const dates = [pos.startDate ?? "?", pos.endDate ?? "present"].join(
        " – ",
      );
      process.stdout.write(`  ${role} (${dates})\n`);
    }
  }

  if (profile.education.length > 0) {
    process.stdout.write("\nEducation:\n");
    for (const edu of profile.education) {
      const parts = [edu.degree, edu.field].filter(Boolean).join(" in ");
      const dates = [edu.startDate, edu.endDate].filter(Boolean).join(" – ");
      const school = edu.school ?? "";
      const schoolWithDates = dates
        ? [school, `(${dates})`].filter(Boolean).join(" ")
        : school;
      const line = [parts, schoolWithDates].filter(Boolean).join(", ");
      if (line) {
        process.stdout.write(`  ${line}\n`);
      }
    }
  }

  if (profile.skills.length > 0) {
    process.stdout.write(
      `\nSkills: ${profile.skills.map((s) => s.name).join(", ")}\n`,
    );
  }

  if (profile.emails.length > 0) {
    process.stdout.write(`Email: ${profile.emails.join(", ")}\n`);
  }

  const publicExtId = profile.externalIds.find(
    (e) => e.typeGroup === "public",
  );
  if (publicExtId) {
    process.stdout.write(
      `\nLinkedIn: linkedin.com/in/${publicExtId.externalId}\n`,
    );
  }
}
