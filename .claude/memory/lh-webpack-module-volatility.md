---
name: LinkedHelper webpack module IDs are volatile
description: Minor LinkedHelper releases frequently shift webpack module IDs; lhremote must resolve services by marker, not ID
type: project
originSessionId: 3aa5775a-fed4-4932-905a-c52788286d54
volatility: stable
last-verified: 2026-05-06
verification: empirical-walk
---
Between LinkedHelper v2.113.11 and v2.113.28, three of four webpack module IDs that lhremote depends on shifted: `userService` (75381 → 10064, export `userService` → `default`), `runningLiAccountsService` (44354 → 37925), `frontendSettingsService` (81954 → 72687). Only `authService` (2742) held.

**Why:** Webpack assigns numeric IDs to modules deterministically based on the module graph; adding or moving any module (e.g. the new `workspaceService` in module 50846) can reshuffle later IDs.

**How to apply:** Never hard-code module IDs in CDP expressions targeting LinkedHelper. Use the marker-based `LauncherService.LH_SERVICES_INIT` snippet (in `packages/core/src/services/launcher.ts`) which scans the webpack registry for exports matching characteristic marker fields (e.g. `_workspacesBS` AND `_selectedWorkspaceBS` together). The snippet caches the result on `window.__lhrServices` per page navigation. When adding new services, extend the `_specs` object with the export key and marker fields — not a numeric ID.

Full background: `research/linkedhelper/architecture/V2113-WEBPACK-MODULE-IDS.md`.

**Verification scope**: the *examples* are 2.113.11 → 2.113.28 (anchor: `research` commit `14b626b`,
2026-05-06). Marked `volatility: stable` deliberately — the actionable rule ("resolve by marker, never
by numeric ID") is version-independent by construction, and is the fail-safe under either answer. Only
the illustrative IDs age.

