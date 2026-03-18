---
description: LinkedIn search URL construction, boolean expressions, entity resolution, filter encoding
globs: ["packages/core/src/services/*url*", "packages/core/src/services/*boolean*", "packages/core/src/services/*entity*", "packages/core/src/data/linkedin*", "packages/mcp/src/tools/*linkedin*", "packages/mcp/src/tools/*build*url*", "packages/mcp/src/tools/*resolve*", "packages/mcp/src/tools/*reference*", "packages/cli/src/handlers/*build*url*", "packages/cli/src/handlers/*resolve*", "packages/cli/src/handlers/*reference*"]
alwaysApply: false
---

# LinkedIn Search URL Construction

Reference for building LinkedIn search URLs programmatically.

## Two URL Encoding Systems

### Basic Search (`/search/results/people/`)
- Standard query params with JSON-array values
- Multi-value filters: `currentCompany=["1441","2345"]`
- Text fields: plain URL-encoded strings
- **Text params** (`company=`, `title=`) are keyword searches only, NOT faceted filters
- **Faceted filters** require numeric IDs (`currentCompany=["1441"]`)

### Sales Navigator (`/sales/search/people`)
- Rest.li protocol encoding in single `query=(...)` param
- Objects: `(key:value,key:value)`
- Lists: `List(elem1,elem2)`
- Filter structure: `filters:List((type:CURRENT_COMPANY,values:List((id:...,selectionType:INCLUDED))))`
- Each filter value has `selectionType: "INCLUDED" | "EXCLUDED"`

## Boolean Expressions (Keywords Field)

LinkedIn supports boolean operators in keyword fields ONLY (not across structured filters).

### Operators (MUST be UPPERCASE)
- `AND` — both terms required: `SaaS AND B2B`
- `OR` — either term: `PM OR "product manager"`
- `NOT` — exclude: `engineer NOT intern`
- `"..."` — exact phrase: `"VP of Engineering"`
- `(...)` — grouping: `VP NOT (assistant OR SVP)`

### Precedence (highest to lowest)
1. Quotes
2. Parentheses
3. NOT
4. AND
5. OR

### Not Supported
- `+`/`-` operators, wildcards `*`, braces/brackets

### Builder Modes
- **Structured**: `{ and: [...], or: [...], not: [...], phrases: [...] }` — auto-compose with correct quoting, casing, parentheses
- **Raw**: `{ raw: "..." }` — passthrough, user handles formatting

## Entity Resolution

LinkedIn filter values use numeric IDs. Resolution via typeahead endpoints:

### Public (No Auth) — Primary
```
GET https://www.linkedin.com/jobs-guest/api/typeaheadHits
  ?typeaheadType=COMPANY|GEO
  &query={searchTerm}
```
Supports: COMPANY, GEO. Returns entity IDs. No authentication required.

### Voyager (Session Auth via CDP) — Fallback + SCHOOL
```
GET https://www.linkedin.com/voyager/api/typeahead/hitsV2
  ?q=type&type=COMPANY|GEO|SCHOOL
  &keywords={searchTerm}&origin=OTHER
```
Required headers: `csrf-token: ajax:{JSESSIONID}`, `X-RestLi-Protocol-Version: 2.0.0`, session cookies (`li_at`, `JSESSIONID`).

Strategy: public endpoint first, CDP Voyager fallback for SCHOOL or when public fails.

## Reference Data (Embeddable Constants)

### Seniority Levels (ID: Name)
1: Unpaid, 2: Training, 3: Entry-level, 4: Senior (IC), 5: Manager, 6: Director, 7: VP, 8: CxO, 9: Partner, 10: Owner

### Company Size Ranges (Code: Range)
A: Self-employed, B: 1-10, C: 11-50, D: 51-200, E: 201-500, F: 501-1K, G: 1K-5K, H: 5K-10K, I: 10K+

### Connection Degrees (Code: Meaning)
F: 1st-degree, S: 2nd-degree, O: 3rd+ and other

### Industries
~434 items. Source: https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/industry-codes-v2

### Job Functions
~35 items. Source: https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/job-function-codes

Note: Sales Navigator uses numeric IDs for functions (e.g., 8=Engineering), not the string codes from the Marketing API.

## URL Parameter Quick Reference

### Basic Search Keys
`keywords`, `currentCompany`, `pastCompany`, `geoUrn`, `industry`, `schoolFilter`, `network`, `profileLanguage`, `serviceCategory`

### SN Filter Types
`CURRENT_COMPANY`, `PAST_COMPANY`, `REGION`, `SENIORITY_LEVEL`, `FUNCTION`, `INDUSTRY`, `COMPANY_HEADCOUNT`, `COMPANY_TYPE`, `CURRENT_TITLE`, `PAST_TITLE`, `YEARS_AT_CURRENT_COMPANY`, `YEARS_IN_CURRENT_POSITION`, `YEARS_OF_EXPERIENCE`, `SCHOOL`, `PROFILE_LANGUAGE`, `GROUP_MEMBER_OF`, `CONNECTION`

## Source Types to URL Patterns

### Rich Builders (filter support)
- `SearchPage` — `/search/results/people/?...`
- `SNSearchPage` — `/sales/search/people?query=(...)`

### Parameterized Templates
- `OrganizationPeople` — `/company/{slug}/people/`
- `Alumni` — `/school/{slug}/people/`
- `Group` — `/groups/{id}/members/`
- `Event` — `/events/{id}/attendees/`
- `SNListPage` — `/sales/lists/people/{id}/`
- `SNOrgsListsPage` — `/sales/lists/company/{id}/`
- `TProjectPage` — `/talent/projects/{id}/`
- `RProjectPage` — `/recruiter/projects/{id}/`

### Fixed URLs (no params needed)
- `MyConnections` — `/mynetwork/invite-connect/connections/`
- `LWVYPP` — `/me/profile-views/`
- `SentInvitationPage` — `/mynetwork/invitation-manager/sent/`
- `FollowersPage` — `/me/my-network/followers/`
- `FollowingPage` — `/me/my-network/following/`
