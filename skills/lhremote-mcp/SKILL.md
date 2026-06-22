---
name: lhremote-mcp
description: This skill should be used when the user asks about lhremote MCP tools, LinkedHelper automation workflows, campaign management, account selection, instance lifecycle, people collection, messaging, or any lhremote CLI/MCP commands. Provides tool discovery patterns, workflow sequences, parameter conventions, error handling, and rate-limiting guidance for automating LinkedHelper via CDP.
version: 1.0.0
---

# lhremote MCP — Tool Surface & Workflow Guide

This skill teaches lhremote MCP workflow patterns, conventions, and error handling for automating LinkedHelper via Chrome DevTools Protocol (CDP).

## Prerequisites

LinkedHelper must be installed locally with an active license. The MCP server connects to it via CDP on a configurable port (default: 9222).

## Tool Discovery

Tools are autodiscovered via the MCP protocol handshake (`tools/list`). Use the MCP tool listing to see available tools and their parameters.

## Workflow Patterns

### Discovery Flow

Always start here when connecting to LinkedHelper for the first time in a session:

```
find-app → list-accounts → check-status
```

1. **`find-app`** — Detect if LinkedHelper is running and get its CDP port
2. **`list-accounts`** — See available accounts (needed for targeting)
3. **`check-status`** — Verify instance health and database connectivity

If `find-app` returns nothing, use `launch-app` first.

### Instance Lifecycle

An instance must be running before campaign/query operations:

```
launch-app → start-instance → [work] → stop-instance → quit-app
```

To recycle a single stuck instance, use `restart-instance` (preferred over manual stop+start):

```
restart-instance(accountId)   # stop → wait for exit → start → wait until connectable → verify
```

Key rules:
- `start-instance` auto-selects the account only when one exists; pass `accountId` when multiple are configured.
- Lifecycle ops (`start/stop/restart/launch/quit`, and `list-accounts`) are **launcher operations** — they go through the single shared launcher and require the launcher CDP to be reachable. They are serialized internally; expect a brief launcher "wobble" during them that self-recovers.
- `restart-instance` and `stop-instance` affect **only the target account's process**. Other instances' processes and campaigns keep running; their CDP may blip briefly, then recovers.
- Trust `check-status` (process inspection), not the immediate `start/stop` return payload, to confirm true state — start payloads can report phantom/duplicate ports.

## Instance Connectability & Stability

**Connectability is eventually-consistent, not binary.** A just-started or momentarily-disrupted instance can report `connectable: false` for up to ~30s and then become connectable on its own. Treat a single non-connectable read as **not** a failure.

Rules for reasoning about instance state:
- **Re-poll before concluding failure.** Poll `check-status` across the ~30s grace window. Only treat an instance as `stuck` if it stays non-connectable for the whole window.
- **Transient vs stuck.** `degraded` (transiently unreachable, within grace) → wait, do nothing. `stuck` (past grace) → `restart-instance`. Use the `readiness` field in `check-status` when available.
- **Don't restart healthy instances.** Restarting a merely-transient instance is unnecessary and itself triggers launcher churn. Diagnose first.
- **Never rapid-fire start/stop.** Use `ensure-instances` (for sets) or `restart-instance` (for one); they serialize and settle between operations. Firing multiple raw `start-instance` calls back-to-back is the known cause of launcher CDP drops.
- **Reads are launcher-independent; writes are not.** `check-status`/`find-app`/`query-*` work even when the launcher CDP is down (identity comes from process inspection). `start/stop/restart/list-accounts` need the launcher reachable and will auto-recover within ~30s; if a launcher op fails, retry after the recovery window rather than escalating.
- **Verify lifecycle results by re-poll.** After start/restart, confirm via `check-status` that the account is connectable on a distinct real port. An unlicensed or failed account produces **no** instance process — expect `failed`/`verified:false`, never a phantom "started".

### Collection Workflow (Primary)

The primary way to populate a campaign with targets. Discovers sources from LinkedIn pages, collects people automatically, and monitors progress:

```
[build search URL] → collect-people → campaign-status → campaign-start
```

**Step 1 — Build a source URL:**

Construct a LinkedIn page URL to collect from. See [Building LinkedIn Search URLs](#building-linkedin-search-urls-for-import) for search URL construction, or use any supported source page (company people, group members, event attendees, etc.). See [Source Type Reference](#source-type-reference) for the full list.

**Step 2 — Collect people into a campaign:**

`collect-people` accepts a LinkedIn page URL and campaign ID. The source type is auto-detected from the URL. Collection runs asynchronously — the call returns immediately.

```
collect-people(campaignId, sourceUrl)
```

Optional parameters:
- `limit` — Maximum profiles to collect
- `maxPages` — Maximum pages to process
- `pageSize` — Results per page
- `sourceType` — Explicit source type to bypass URL auto-detection
- `accountId` — Required when multiple accounts are configured (see [Parameter Conventions](#parameter-conventions))

**Step 3 — Monitor collection progress:**

Poll `campaign-status` to track collection progress. The campaign's people list grows as profiles are collected.

**Step 4 — Start the campaign:**

Once collection is complete (or enough people are collected), use `campaign-start` with the collected `personIds`.

**Collection rate limiting:** Collection respects LinkedHelper's internal pacing. For large source pages (1000+ results), use `limit` or `maxPages` to control scope. Only one collection can run at a time per instance — attempting a second returns a `CollectionBusyError`.

### Campaign Creation & Execution

Full workflow for creating and running a campaign:

```
describe-actions → campaign-create → [populate targets] → campaign-start → campaign-status / campaign-statistics
```

**Step 1 — Discover action types:**

Use `describe-actions` to see available action types and their configuration schemas before building a campaign config.

**Step 2 — Create the campaign:**

`campaign-create` accepts YAML (default) or JSON configuration:

```yaml
version: "1"
name: "Visit & Connect"
actions:
  - type: "VisitAndExtract"
    cooldownMs: 60000
    maxActionsPerRun: 10
  - type: "InvitePerson"
    config:
      message: "Hi {firstName}, I'd like to connect!"
```

**Step 3 — Populate targets:**

Three methods for adding people to a campaign:

| Method | Tool | Best For |
|--------|------|----------|
| **Collection** (recommended) | `collect-people` | Automated discovery from LinkedIn pages |
| **From Lists** | `import-people-from-collection` | Reusing curated people sets across campaigns |
| **Direct URL import** | `import-people-from-urls` | Known LinkedIn profile URLs |

For `import-people-from-urls`: This is idempotent — re-importing the same person is a no-op. For bulk imports (1000+ URLs), use the CLI instead:

```bash
lhremote import-people-from-urls <campaignId> --urls-file <path> --cdp-port <port> [--account-id <id>]
```

URL file: one LinkedIn profile URL per line. Get `cdp-port` from `find-app` output.

**Step 4 — Start execution:**

`campaign-start` requires both `campaignId` and `personIds` (the internal IDs, not LinkedIn URLs). It returns immediately — execution is asynchronous.

**Step 5 — Monitor progress:**

- `campaign-status` — Real-time execution state (with optional `includeResults`)
- `campaign-statistics` — Aggregated success/error counts per action

### Campaign Action Chain Management

Campaigns contain ordered action chains. Manage them with:

- `campaign-add-action` — Append an action (use `describe-actions` to discover types)
- `campaign-remove-action` — Remove by action ID
- `campaign-reorder-actions` — Reorder by providing action IDs in desired order
- `campaign-move-next` — Advance specific persons to the next action

### Lists Management

LinkedHelper collections (Lists) are reusable sets of people that persist across campaigns. Use them to curate target audiences and import into multiple campaigns.

**CRUD operations:**

```
create-collection → add-people-to-collection → [use in campaigns] → delete-collection
```

- **`create-collection`** — Create a named List. Returns the new `collectionId`.
- **`list-collections`** — List all named Lists with people counts.
- **`delete-collection`** — Delete a List and all its people associations. Does not delete the people themselves.
- **`add-people-to-collection`** — Add people by `personIds`. Idempotent — adding an already-present person is a no-op.
- **`remove-people-from-collection`** — Remove people by `personIds`.

**Import into campaign:**

`import-people-from-collection` reads all LinkedIn profile URLs from a List and feeds them into a campaign. Large sets are automatically chunked.

```
import-people-from-collection(collectionId, campaignId)
```

**Typical workflow:**

```
1. Create a List                → create-collection("Senior Engineers SF")
2. Collect into it              → collect-people(campaignId, sourceUrl) or add-people-to-collection
3. Review/curate                → list-collections to verify counts
4. Import into campaign         → import-people-from-collection(collectionId, campaignId)
5. Reuse for another campaign   → import-people-from-collection(collectionId, anotherCampaignId)
```

### Messaging Workflow

```
check-replies → query-messages
```

- `check-replies` triggers LinkedHelper to fetch new replies from LinkedIn, then returns messages since a cutoff (default: last 24 hours)
- `query-messages` searches the local database — use `personId` to filter by contact, `chatId` for a specific thread, or `search` for text search
- `scrape-messaging-history` does a full scrape of all LinkedIn messages into the local database

### Data Queries (No Campaign Needed)

Profile and message queries work against the local LinkedHelper database — no campaign execution required, but an instance must be running.

> **Note:** `campaign-list` connects via CDP (like all other campaign commands) and requires a running instance. It lists campaigns for the resolved account only. Pass `accountId` when multiple accounts are configured.

- `query-profile` — Look up by `personId` (internal) or `publicId` (LinkedIn URL slug like `jane-doe-12345`)
- `query-profiles` — Search by name/headline (`query`) or company, with `limit`/`offset` pagination

## Parameter Conventions

- **`cdpPort`**: Optional on all tools, defaults to `9222`. Only change if LinkedHelper runs on a non-default port.
- **`accountId`**: Optional when only one account exists (auto-resolved). Required when multiple accounts are configured.
- **`campaignId`** / **`actionId`** / **`personId`**: Internal LinkedHelper integer IDs (not LinkedIn public IDs).
- **`format`**: Campaign config format — `"yaml"` (default) or `"json"`.
- **`publicId`**: The LinkedIn profile URL slug (e.g., `jane-doe-12345` from `linkedin.com/in/jane-doe-12345`).

## Startup Timing on Windows

After `launch-app`, LinkedHelper briefly drops its CDP port while reconnecting to any existing instance processes. All commands that use CDP auto-discovery automatically retry for up to 30 seconds before failing. This means:

- Commands issued immediately after `launch-app` may take up to 30 s to respond while LH stabilizes — this is expected.
- If LH never becomes reachable within that window, the "LinkedHelper is running but CDP is not reachable" error is raised.
- `check-status` intentionally bypasses the retry and returns the current state immediately (fast health probe).

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No running LinkedHelper instances found" | App not running | Use `launch-app` |
| "LinkedHelper is running but CDP is not reachable" | LH process exists but CDP not yet available | Commands auto-retry for up to 30 s; if it persists, use `launch-app --force` |
| "Failed to connect to LinkedHelper" | Wrong CDP port or app crashed | Use `find-app` to discover correct port |
| "Instance not running" | Instance not started for account | Use `start-instance` |
| "No accounts found" / "Multiple accounts" | Account resolution failed | Use `list-accounts`, then pass explicit `accountId` |
| "Campaign not found" | Invalid campaign ID | Use `campaign-list` to find valid IDs |
| "Campaign start timed out" | LinkedHelper unresponsive | Check `check-status`, retry |
| "Cannot collect — instance is busy" | Another collection in progress | Wait for current collection to finish, then retry |
| "Collection failed" | Source URL invalid or unsupported | Check URL against source type reference, try explicit `sourceType` |
| "Instance started but not connectable" | Transient — launcher churn or still initializing | Re-poll `check-status` for ~30s; it usually self-recovers. Do not restart yet. |
| Instance non-connectable past the ~30s grace window | Genuinely stuck instance | `restart-instance <accountId>` — recycles only that instance; others keep running |
| `ensure-instances`/`start-instance` returns `verified: false` | Verification ran before the instance settled, or a phantom/duplicate port was reported | Confirm true state with `check-status`; the instance often is up. With v0.22.0 verification polls until the grace window. |
| Launcher `reachable: false` during a lifecycle op | Launcher CDP dropped (often after rapid starts) | Lifecycle ops auto-recover within ~30s; retry after the window. Reads still work meanwhile. |
| Multiple `start-instance` calls report the same CDP port | Phantom/duplicate port; instances not yet distinctly bound | Ignore the port in the payload; read real ports from `check-status` once settled |
| Account requested but no instance process ever appears | Account has no LH license / failed to launch | Reported as `failed`/`verified:false`; not a tooling error — verify the account's license |

## Action Type Reference

Use `describe-actions` to get full schemas. The available action types are:

| Type | Category | Purpose |
|------|----------|---------|
| `VisitAndExtract` | people | Visit LinkedIn profile and extract data |
| `InvitePerson` | people | Send connection request |
| `MessageToPerson` | messaging | Send message to connection |
| `InMail` | messaging | Send InMail to non-connection |
| `CheckForReplies` | messaging | Check for new message replies |
| `Follow` | engagement | Follow a LinkedIn profile |
| `EndorseSkills` | engagement | Endorse skills on a profile |
| `PersonPostsLiker` | engagement | Like posts by a person |
| `FilterContactsOutOfMyNetwork` | people | Filter out non-connections |
| `RemoveFromFirstConnection` | people | Remove from first connections |
| `DataEnrichment` | crm | Enrich profile data |
| `ScrapeMessagingHistory` | messaging | Scrape messaging history |
| `Waiter` | workflow | Wait for a configured delay |

## Source Type Reference

`collect-people` auto-detects the source type from the URL. You can also pass `sourceType` explicitly.

### Free Tier (LinkedIn Basic)

| Source Type | URL Pattern | Description |
|-------------|-------------|-------------|
| `SearchPage` | `/search/results/people/` | People search results |
| `MyConnections` | `/mynetwork/invite-connect/connections/` | Your connections list |
| `Alumni` | `/school/{id}/people/` | School alumni page |
| `OrganizationPeople` | `/company/{id}/people/` | Company people page |
| `Group` | `/groups/{id}/members/` | Group members |
| `Event` | `/events/{id}/attendees/` | Event attendees |
| `LWVYPP` | `/me/profile-views/` | Who viewed your profile |
| `SentInvitationPage` | `/mynetwork/invitation-manager/sent/` | Sent connection invitations |
| `FollowersPage` | `/me/my-network/followers/` | Your followers |
| `FollowingPage` | `/me/my-network/following/` | People you follow |

### Sales Navigator Tier

| Source Type | URL Pattern | Description |
|-------------|-------------|-------------|
| `SNSearchPage` | `/sales/search/people` | Sales Navigator people search |
| `SNListPage` | `/sales/lists/people/` | Sales Navigator saved lists (people) |
| `SNOrgsPage` | `/sales/search/company` | Sales Navigator company search |
| `SNOrgsListsPage` | `/sales/lists/company/` | Sales Navigator saved lists (companies) |

### Recruiter Tier

| Source Type | URL Pattern | Description |
|-------------|-------------|-------------|
| `TSearchPage` | `/talent/search/` | Recruiter search |
| `TProjectPage` | `/talent/projects/` | Recruiter projects |
| `RSearchPage` | `/recruiter/search/` | Recruiter Lite search |
| `RProjectPage` | `/recruiter/projects/` | Recruiter Lite projects |

## Building LinkedIn Search URLs for Import

To populate a campaign with targets, you need LinkedIn profile URLs. The most common source is LinkedIn's people search. You can construct search URLs programmatically and then use LinkedHelper or browser automation to collect the resulting profile URLs for import.

### Basic People Search URL

Base: `https://www.linkedin.com/search/results/people/?`

Parameters are appended as `&key=value`. Faceted filters use URL-encoded JSON arrays of strings.

### Encoding Rule

All faceted parameters (except `keywords`, `firstName`, `lastName`, `title`) use URL-encoded JSON arrays:

```
["12345"]       → %5B%2212345%22%5D
["12345","678"] → %5B%2212345%22%2C%22678%22%5D
```

Characters: `[` → `%5B`, `]` → `%5D`, `"` → `%22`, `,` → `%2C`

### Parameter Reference

| Parameter | Type | Description |
|-----------|------|-------------|
| `keywords` | Plain text | Free-text search across all profile fields. Supports Boolean: `AND`, `OR`, `NOT`, `"exact phrase"`, `(grouping)` |
| `network` | JSON array | Connection degree: `"F"` (1st), `"S"` (2nd), `"O"` (3rd+) |
| `geoUrn` | JSON array | Location IDs (see geo table below) |
| `currentCompany` | JSON array | Company IDs for current employer |
| `pastCompany` | JSON array | Company IDs for previous employers |
| `school` | JSON array | Educational institution IDs |
| `industry` | JSON array | Industry code IDs |
| `profileLanguage` | JSON array | ISO 639-1 codes: `"en"`, `"fr"`, `"de"`, `"es"` |
| `serviceCategory` | JSON array | Service category IDs (for freelancers) |
| `firstName` | Plain text | First name filter |
| `lastName` | Plain text | Last name filter |
| `title` | Plain text | Job title filter. Supports Boolean |
| `connectionOf` | JSON array | Profile hash — search within someone's connections |

### Common Geo URN IDs

| Location | ID |
|----------|-----|
| United States | 103644278 |
| Canada | 101174742 |
| United Kingdom | 101165590 |
| France | 105015875 |
| Germany | 101282230 |
| Spain | 105646813 |
| Italy | 103350119 |
| Netherlands | 102890719 |
| Switzerland | 106693272 |
| India | 102713980 |
| Australia | 101452733 |
| Brazil | 106057199 |
| Japan | 101355337 |
| SF Bay Area | 90000084 |

### Discovering IDs

To find IDs for companies, schools, industries, or locations not listed above:

1. **URL inspection**: Apply the filter in LinkedIn's UI, then read the ID from the browser URL bar
2. **Company page trick**: Visit a company page → click "See all jobs" → the URL contains `f_C=<companyId>`
3. **Network tab**: Open browser DevTools → Network tab → type in a filter box → inspect the typeahead XHR request for the returned IDs

### Example URLs

**2nd-degree connections at Microsoft in SF Bay Area with "Senior Engineer" title:**

```
https://www.linkedin.com/search/results/people/?currentCompany=%5B%221035%22%5D&geoUrn=%5B%2290000084%22%5D&network=%5B%22S%22%5D&title=Senior%20Engineer&origin=FACETED_SEARCH
```

**French-speaking software industry professionals:**

```
https://www.linkedin.com/search/results/people/?industry=%5B%224%22%5D&profileLanguage=%5B%22fr%22%5D&origin=FACETED_SEARCH
```

**Boolean keyword search for founders or CEOs in Germany:**

```
https://www.linkedin.com/search/results/people/?keywords=founder%20OR%20CEO&geoUrn=%5B%22101282230%22%5D&origin=FACETED_SEARCH
```

### Sales Navigator Search URLs

Sales Navigator uses a different base URL and encoding:

- **Lead search**: `https://www.linkedin.com/sales/search/people?query=...`
- **Account search**: `https://www.linkedin.com/sales/search/company?query=...`

The `query` parameter uses a proprietary nested list syntax:

```
query=(filters:List((type:REGION,values:List((id:105015875,text:France,selectionType:INCLUDED)))))
```

This gets percent-encoded in the URL. Each filter has `type`, `id`, `text`, and `selectionType` (`INCLUDED` or `EXCLUDED`).

Common Sales Navigator filter types and IDs:

| Filter Type | Example IDs |
|-------------|-------------|
| `FUNCTION` | 8 (Engineering), 13 (IT), 19 (Product Management) |
| `SENIORITY_LEVEL` | 220 (Director), 300 (VP), 310 (CXO), 320 (Owner/Partner) |
| `REGION` | Same geo IDs as basic search |
| `INDUSTRY` | Same industry IDs as basic search |
| `CURRENT_COMPANY` | Company IDs (may use `urn:li:organization:<id>` format) |
| `COMPANY_HEADCOUNT` | B (1-10), C (11-50), D (51-200), E (201-500), F (501-1000), G (1001-5000) |

### Search-to-Campaign Workflow

```
1. Build search URL    → construct URL with desired filters (see above)
2. Collect into campaign → collect-people(campaignId, sourceUrl) — automated, no browser needed
3. Monitor progress    → poll campaign-status until collection completes
4. Start campaign      → campaign-start with collected person IDs
```

This replaces the manual browser-based workflow. `collect-people` handles page navigation and profile extraction internally.

**Alternative (manual URL import):**

If you already have a list of LinkedIn profile URLs from another source:

```
1. Import to campaign → import-people-from-urls (MCP or CLI)
2. Start campaign     → campaign-start with imported person IDs
```

LinkedIn limits search results to ~2,500 per query. For larger target lists, split the search into smaller segments (e.g., by sub-region or industry) so each sub-query stays under the limit.

## Rate Limiting

LinkedIn enforces undisclosed rate limits. Exceeding them triggers warnings or account restrictions that are difficult to reverse.

### Campaign Actions

| Parameter | Recommended |
|-----------|-------------|
| Daily safe volume | 100–200 visits/day |
| Conservative start | 50/day, scale up after validation |
| Cooldown between visits | 60s minimum |

Start conservative. LinkedIn warnings are easier to prevent than to recover from. Configure `cooldownMs` (60000–90000) and `maxActionsPerRun` (5–10) on campaign actions accordingly.

### Collection Operations

| Parameter | Recommended |
|-----------|-------------|
| Profiles per collection run | Use `limit` to cap at 1000 per run |
| Pages per run | Use `maxPages` to limit pagination depth |
| Concurrent collections | 1 (enforced — `CollectionBusyError` if exceeded) |
| Between collection runs | Wait for one to complete before starting another |

Collection uses LinkedHelper's internal pacing. For large source pages, limit scope with `limit` or `maxPages` rather than collecting everything at once.

## Common Pitfalls

| Pitfall | Correct Approach |
|---------|------------------|
| Hardcoding CDP port | Read from `find-app` or `launch-app` output each session — the port is dynamic |
| Skipping startup sequence | Always: `launch-app` → `start-instance` → operate |
| Bulk import via MCP tool for large lists | Use CLI with `--urls-file` for 1000+ URLs |
| Starting at maximum rate | Start at 50/day, scale after confirming no LinkedIn warnings |
| Starting a second collection while one runs | Wait for the first to complete — only one collection per instance |
| Collecting without `limit` on large searches | Use `limit` or `maxPages` to control scope on searches with 1000+ results |
| Using `import-people-from-urls` when `collect-people` works | Prefer `collect-people` — it handles page navigation and extraction automatically |
| Multiple accounts configured but no `accountId` passed | Pass `accountId` to all campaign, targeting, and people-import tools; use `list-accounts` to find the ID |
| Calling `campaign-list` without a running instance | `campaign-list` now connects via CDP — start an instance first; it is not a purely local database query |
| Judging instance health on a single `connectable` read | Connectability is eventually-consistent; re-poll across the ~30s grace window |
| Restarting an instance that's just transiently unreachable | Diagnose transient (`degraded`) vs `stuck` first; only restart after the grace window |
| Raw back-to-back `start-instance` calls | Use `ensure-instances`/`restart-instance` — they serialize and settle, avoiding launcher drops |
| Trusting the `start-instance` port in its return payload | Confirm real ports via `check-status` after the instance settles |
