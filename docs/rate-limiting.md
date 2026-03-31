# Rate Limiting

LinkedIn monitors automated activity and may issue warnings or restrict accounts that visit too many profiles too quickly. lhremote provides two campaign settings to control pacing:

| Setting | YAML field | Scope | Default | Description |
|---------|------------|-------|---------|-------------|
| Cooldown | `cooldownMs` | Campaign or per-action | 60 000 ms (60 s) | Minimum delay between individual profile visits |
| Max actions per run | `maxActionsPerRun` | Campaign or per-action | 10 | Profiles processed per campaign execution cycle |

## Recommended limits for VisitAndExtract

| Phase | Daily visits | `maxActionsPerRun` | `cooldownMs` |
|-------|-------------|--------------------|--------------|
| Warm-up (first week) | ~50 | 5 | 90 000 |
| Cruising (no warnings) | 100–200 | 10 | 60 000 |

Start conservative and increase only after confirming no LinkedIn warnings. Warnings are easier to prevent than recover from.

## Example: rate-limited campaign

```yaml
version: "1"
name: "Profile Enrichment (safe)"
description: "Visit and extract with conservative pacing"
settings:
  cooldownMs: 90000
  maxActionsPerRun: 5
actions:
  - type: VisitAndExtract
```

Both `cooldownMs` and `maxActionsPerRun` can be set at the campaign level (under `settings`) or overridden per action. Per-action values take priority over the campaign default.

> **Tip**: If you receive a LinkedIn warning, stop the campaign immediately, wait 24–48 hours, then resume with lower limits.
