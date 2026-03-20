// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type BuildLinkedInUrlInput, buildLinkedInUrl } from "@lhremote/core";
import { z } from "zod";
import { mcpError, mcpSuccess } from "../helpers.js";

const snFilterValueSchema = z.object({
  id: z.string().describe("Entity ID or URN"),
  text: z.string().optional().describe("Display text"),
  selectionType: z
    .enum(["INCLUDED", "EXCLUDED"])
    .describe("Include or exclude this value"),
});

const snFilterSchema = z.object({
  type: z
    .string()
    .describe(
      "Filter type (CURRENT_COMPANY, PAST_COMPANY, REGION, SENIORITY_LEVEL, FUNCTION, INDUSTRY, COMPANY_HEADCOUNT, COMPANY_TYPE, CURRENT_TITLE, PAST_TITLE, YEARS_AT_CURRENT_COMPANY, YEARS_AT_CURRENT_POSITION, YEARS_OF_EXPERIENCE, SCHOOL, PROFILE_LANGUAGE, GROUP, CONNECTION)",
    ),
  values: z.array(snFilterValueSchema).describe("Filter values"),
});

const booleanExpressionSchema = z.union([
  z.object({
    and: z.array(z.string()).optional().describe("Terms joined with AND"),
    or: z.array(z.string()).optional().describe("Terms grouped with OR"),
    not: z.array(z.string()).optional().describe("Terms negated with NOT"),
    phrases: z
      .array(z.string())
      .optional()
      .describe("Exact phrases (quoted)"),
  }),
  z.object({
    raw: z.string().describe("Raw boolean expression string"),
  }),
]);

/** Register the {@link https://github.com/alexey-pelykh/lhremote#build-linkedin-url | build-linkedin-url} MCP tool. */
export function registerBuildLinkedInUrl(server: McpServer): void {
  server.tool(
    "build-linkedin-url",
    "Build a LinkedIn URL for any supported source type. Dispatches to the appropriate builder based on sourceType: SearchPage (basic search with faceted filters), SNSearchPage (Sales Navigator with Rest.li encoding), parameterised templates (company/school/group/event pages), or fixed URLs (connections, profile views, etc.).",
    {
      sourceType: z
        .string()
        .describe(
          "LinkedIn source type (SearchPage, SNSearchPage, OrganizationPeople, Alumni, Group, Event, MyConnections, LWVYPP, SentInvitationPage, FollowersPage, FollowingPage, SNListPage, SNOrgsPage, SNOrgsListsPage, TSearchPage, TProjectPage, RSearchPage, RProjectPage)",
        ),

      // SearchPage params
      keywords: z
        .union([z.string(), booleanExpressionSchema])
        .optional()
        .describe("Keywords (string or structured boolean expression)"),
      currentCompany: z
        .array(z.string())
        .optional()
        .describe("Current company IDs (SearchPage)"),
      pastCompany: z
        .array(z.string())
        .optional()
        .describe("Past company IDs (SearchPage)"),
      geoUrn: z
        .array(z.string())
        .optional()
        .describe("Geographic URN IDs (SearchPage)"),
      industry: z
        .array(z.string())
        .optional()
        .describe("Industry IDs (SearchPage)"),
      school: z
        .array(z.string())
        .optional()
        .describe("School IDs (SearchPage)"),
      network: z
        .array(z.string())
        .optional()
        .describe('Connection degree codes: "F", "S", "O" (SearchPage)'),
      profileLanguage: z
        .array(z.string())
        .optional()
        .describe("Profile language codes (SearchPage)"),
      serviceCategory: z
        .array(z.string())
        .optional()
        .describe("Service category IDs (SearchPage)"),

      // SNSearchPage params
      filters: z
        .array(snFilterSchema)
        .optional()
        .describe("Sales Navigator filters (SNSearchPage)"),

      // Parameterised template params
      slug: z
        .string()
        .optional()
        .describe("Company or school slug (OrganizationPeople, Alumni)"),
      id: z
        .string()
        .optional()
        .describe(
          "Entity ID (Group, Event, SNListPage, SNOrgsListsPage, TProjectPage, RProjectPage)",
        ),
    },
    async (args) => {
      try {
        // Strip undefined values to satisfy exactOptionalPropertyTypes
        const input: BuildLinkedInUrlInput = {
          sourceType: args.sourceType,
          ...(args.keywords !== undefined && { keywords: args.keywords }),
          ...(args.currentCompany !== undefined && { currentCompany: args.currentCompany }),
          ...(args.pastCompany !== undefined && { pastCompany: args.pastCompany }),
          ...(args.geoUrn !== undefined && { geoUrn: args.geoUrn }),
          ...(args.industry !== undefined && { industry: args.industry }),
          ...(args.school !== undefined && { school: args.school }),
          ...(args.network !== undefined && { network: args.network }),
          ...(args.profileLanguage !== undefined && { profileLanguage: args.profileLanguage }),
          ...(args.serviceCategory !== undefined && { serviceCategory: args.serviceCategory }),
          ...(args.filters !== undefined && { filters: args.filters }),
          ...(args.slug !== undefined && { slug: args.slug }),
          ...(args.id !== undefined && { id: args.id }),
        };
        const result = buildLinkedInUrl(input);
        return mcpSuccess(JSON.stringify(result, null, 2));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return mcpError(message);
      }
    },
  );
}
