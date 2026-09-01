---
name: Request GitHub Copilot PR review via REST API
description: The reviewer slug for requesting a Copilot code review on a PR is `copilot-pull-request-reviewer[bot]` (full bot login WITH the `[bot]` suffix); `@Copilot` comments do not trigger; GraphQL `requestReviews` does not accept Bot-type nodes
type: reference
originSessionId: 69536507-4e39-489b-baa1-611af227cc15
volatility: high
last-verified: 2026-09-01
verification: empirical-walk
---
To re-request a GitHub Copilot code review on a PR via API:

```bash
gh api --method POST "repos/{owner}/{repo}/pulls/{pr}/requested_reviewers" \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
```

The `[bot]` suffix is load-bearing. Confirmed 2026-04-20 on PR alexey-pelykh/lhremote#752.

**What did NOT work:**

| Attempted | Result |
|---|---|
| `reviewers[]=Copilot` | 201 Created but `requested_reviewers: []` in response — silently no-op |
| `reviewers[]=copilot-pull-request-reviewer` (no `[bot]`) | 422 "Reviews may only be requested from collaborators" |
| `gh pr edit {pr} --add-reviewer Copilot` | "Could not resolve user with login 'copilot'" (CLI lowercases + resolves as User only) |
| GraphQL `requestReviews(userIds: [BOT_kgDOCnlnWA])` | `NOT_FOUND` — the `userIds` field only accepts User-type nodes, not Bot-type |
| `@Copilot` PR comment | Does NOT trigger Copilot review. Copilot doesn't read replies or mentions. |

**Verifying the request landed:**

```bash
# Shows Bot-type reviewers (the request DID land):
gh api "repos/{o}/{r}/pulls/{pr}" --jq '.requested_reviewers[] | {login, type}'

# gh CLI's JSON field hides Bot-type reviewers (misleadingly empty):
gh pr view {pr} --json reviewRequests    # bot reviewers NOT shown here
```

**Filtering Copilot review records:**

- `/pulls/{pr}/reviews` → `.[].user.login` is `copilot-pull-request-reviewer[bot]`
- `/pulls/{pr}/comments` → `.[].user.login` is `Copilot` (display-name, not login)
- Use a regex like `test("^Copilot$|copilot-pull-request-reviewer")` to match both.

**Auto re-request on push:** off by default. Repository ruleset of type `copilot_code_review` with `"review_on_push": true` (Settings → Rules → Rulesets) can enable it. Without that, every push requires an explicit API re-request.

**Authoritative reference:** `github-copilot` skill § "Requesting a Review".

## Rulesets change the picture (walked 2026-09-01)

If a repository ruleset of type `copilot_code_review` is active, **the review fires automatically on
PR open and the manual REST request above becomes a no-op** — it returns `201` with
`requested_reviewers: []`, which is indistinguishable from the "wrong slug" failure documented above.

Walked on `alexey-pelykh/lhremote` PR #842: the explicit request returned an empty
`requested_reviewers`, and the review from `copilot-pull-request-reviewer[bot]` arrived **~135 s
later anyway**, driven by the ruleset. `alexey-pelykh/lhremote` has such a ruleset
("Copilot review for default branch", `review_on_push: false`, `review_draft_pull_requests: false`).

**How to apply:** before concluding the slug is wrong, check
`gh api repos/{o}/{r}/rulesets` for a `copilot_code_review` rule. If one exists, do not diagnose from
`requested_reviewers` at all — poll `/pulls/{pr}/reviews` instead. `review_on_push: false` means
subsequent pushes still need an explicit re-request.

