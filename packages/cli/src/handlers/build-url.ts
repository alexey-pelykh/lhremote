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
  // Format: "TYPE:ID:TEXT:INCLUDED|EXCLUDED"
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
      const parts = raw.split(":");
      if (parts.length < 3) {
        process.stderr.write(
          `Invalid filter format: "${raw}"\n` +
            'Expected: "TYPE:ID:INCLUDED|EXCLUDED" or "TYPE:ID:TEXT:INCLUDED|EXCLUDED"\n',
        );
        process.exitCode = 1;
        return;
      }

      // Last segment is selectionType, first is type, everything in
      // between is ID (+ optional text). This supports IDs with colons
      // (e.g. URNs like urn:li:organization:1441).
      const rawSelection = parts[parts.length - 1] ?? "";
      if (rawSelection !== "INCLUDED" && rawSelection !== "EXCLUDED") {
        process.stderr.write(
          `Invalid selectionType "${rawSelection}" in filter "${raw}"\n` +
            "Last segment must be INCLUDED or EXCLUDED\n",
        );
        process.exitCode = 1;
        return;
      }

      const selectionType: "INCLUDED" | "EXCLUDED" = rawSelection;
      const type = parts[0] ?? "";
      const middle = parts.slice(1, parts.length - 1);

      // middle contains ID and optional TEXT. The last middle segment
      // is TEXT if it looks like display text (non-empty and not a URN
      // component). For simplicity: if middle has 1 element, it's the ID.
      // If >1, the last element is TEXT and the rest form the ID (joined
      // with colons to reconstruct URN-style IDs).
      let id: string;
      let text: string | undefined;

      if (middle.length <= 1) {
        id = middle[0] ?? "";
      } else {
        id = middle.slice(0, -1).join(":");
        const rawText = middle[middle.length - 1] ?? "";
        text = rawText.length > 0 ? rawText : undefined;
      }

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
