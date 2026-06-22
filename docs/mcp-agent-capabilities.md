# MCP Agent Capabilities

This guide describes the MCP workflow a coding agent should use to control LinkedHelper through lhremote.

## Recommended Workflow

1. Start or discover LinkedHelper:
   - `launch-app`
   - `find-app`
   - `check-status`

2. Select the account and instance:
   - `list-workspaces`
   - `list-accounts`
   - `start-instance`

3. Build or inspect the campaign:
   - `campaign-list`
   - `campaign-get`
   - `campaign-export`
   - `describe-actions`
   - `campaign-validate-action-settings`

4. Create or update campaign actions:
   - `campaign-create`
   - `campaign-add-action`
   - `campaign-update-action`
   - `campaign-clone-action`
   - `campaign-remove-action`
   - `campaign-reorder-actions`

5. Add people to the campaign:
   - `import-people-from-urls` for explicit LinkedIn profile URLs
   - `campaign-import-from-source-url` for search result, company people, group member, or connection source URLs
   - `import-people-from-collection` for existing LinkedHelper lists

6. Run and monitor:
   - `campaign-start`
   - `campaign-status`
   - `campaign-statistics`
   - `campaign-stop`
   - `get-action-budget`
   - `get-throttle-status`

## Action Settings Safety

Before adding or updating an action node, call:

```text
describe-actions
campaign-validate-action-settings
```

`describe-actions` returns the known LinkedHelper action types and their settings schema. `campaign-validate-action-settings` checks a proposed JSON object for missing required keys, unknown keys, and basic type mismatches.

Validation is intentionally conservative. It catches common agent mistakes before writing to the LinkedHelper database, but it does not replace LinkedHelper runtime validation.

## Source URL Imports

Use `campaign-import-from-source-url` when the user gives a LinkedIn source URL rather than individual profile URLs. Typical sources include:

- LinkedIn people search results
- Sales Navigator or filtered search pages supported by LinkedHelper
- Company people pages
- Group member pages
- My connections pages

The tool starts LinkedHelper's collection flow and returns immediately. Poll with `campaign-status` to monitor progress.

## Current Boundaries

MCP supports end-to-end campaign automation and action-chain editing. It does not expose every raw internal LinkedHelper UI field as a standalone tool. For low-level action settings, agents should use `describe-actions`, validate the desired settings, and then write them through `campaign-add-action`, `campaign-update-action`, or `campaign-clone-action`.
