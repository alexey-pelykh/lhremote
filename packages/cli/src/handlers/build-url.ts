// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { type BuildLinkedInUrlInput, buildLinkedInUrl } from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#build-url | build-url} CLI command. */
export function handleBuildUrl(
  sourceType: string,
  options: {
    keywords?: string;
    currentCompany?: string[];
    pastCompany?: string[];
    geo?: string[];
    industry?: string[];
    school?: string[];
    network?: string[];
    profileLanguage?: string[];
    serviceCategory?: string[];
    filter?: string[];
    slug?: string;
    id?: string;
    json?: boolean;
  },
): void {
  // Parse --filter options for SNSearchPage
  // Format: "TYPE|ID|INCLUDED" or "TYPE|ID|TEXT|INCLUDED"
  let filters: Array<{
    type: string;
    values: Array<{
      id: string;
      text?: string;
      selectionType: "INCLUDED" | "EXCLUDED";
    }>;
  }> | undefined;

  if (options.filter !== undefined && options.filter.length > 0) {
    const filterMap = new Map<
      string,
      Array<{
        id: string;
        text?: string;
        selectionType: "INCLUDED" | "EXCLUDED";
      }>
    >();

    for (const raw of options.filter) {
      // Use pipe delimiter to avoid conflicts with colons in URN IDs
      // (e.g. urn:li:organization:1441)
      const segments = raw.split("|");
      if (segments.length < 3 || segments.length > 4) {
        process.stderr.write(
          `Invalid filter format: "${raw}"\n` +
            'Expected: "TYPE|ID|INCLUDED" or "TYPE|ID|TEXT|INCLUDED"\n' +
            "Example: CURRENT_COMPANY|urn:li:organization:1441|Google|INCLUDED\n",
        );
        process.exitCode = 1;
        return;
      }

      const type = segments[0] ?? "";
      let id: string;
      let text: string | undefined;
      let rawSelection: string;

      if (segments.length === 4) {
        id = segments[1] ?? "";
        const rawText = segments[2] ?? "";
        text = rawText.length > 0 ? rawText : undefined;
        rawSelection = segments[3] ?? "";
      } else {
        id = segments[1] ?? "";
        rawSelection = segments[2] ?? "";
      }

      if (rawSelection !== "INCLUDED" && rawSelection !== "EXCLUDED") {
        process.stderr.write(
          `Invalid selectionType "${rawSelection}" in filter "${raw}"\n` +
            "Must be INCLUDED or EXCLUDED\n",
        );
        process.exitCode = 1;
        return;
      }

      const selectionType: "INCLUDED" | "EXCLUDED" = rawSelection;
      const existing = filterMap.get(type);
      const entry = { id, ...(text !== undefined && { text }), selectionType };
      if (existing !== undefined) {
        existing.push(entry);
      } else {
        filterMap.set(type, [entry]);
      }
    }

    filters = Array.from(filterMap.entries()).map(([type, values]) => ({
      type,
      values,
    }));
  }

  try {
    const input: BuildLinkedInUrlInput = {
      sourceType,
      ...(options.keywords !== undefined && { keywords: options.keywords }),
      ...(options.currentCompany !== undefined && options.currentCompany.length > 0 && { currentCompany: options.currentCompany }),
      ...(options.pastCompany !== undefined && options.pastCompany.length > 0 && { pastCompany: options.pastCompany }),
      ...(options.geo !== undefined && options.geo.length > 0 && { geoUrn: options.geo }),
      ...(options.industry !== undefined && options.industry.length > 0 && { industry: options.industry }),
      ...(options.school !== undefined && options.school.length > 0 && { school: options.school }),
      ...(options.network !== undefined && options.network.length > 0 && { network: options.network }),
      ...(options.profileLanguage !== undefined && options.profileLanguage.length > 0 && { profileLanguage: options.profileLanguage }),
      ...(options.serviceCategory !== undefined && options.serviceCategory.length > 0 && { serviceCategory: options.serviceCategory }),
      ...(filters !== undefined && { filters }),
      ...(options.slug !== undefined && { slug: options.slug }),
      ...(options.id !== undefined && { id: options.id }),
    };
    const result = buildLinkedInUrl(input);

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(result.url + "\n");
      for (const warning of result.warnings) {
        process.stderr.write(`Warning: ${warning}\n`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
