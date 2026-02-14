# Roadmap

This is a living document. Timelines are approximate and priorities may shift as the
project evolves. For the latest changes, see [CHANGELOG.md](CHANGELOG.md).

## Next Release: v0.2.0

A major capability expansion over v0.1.0, adding full campaign lifecycle management,
messaging tools, and significant infrastructure hardening.

**Campaign management** — create, configure, execute, monitor, export, and retry
campaigns via `campaign-*` tools. Includes action chain management, exclude lists, bulk
people import, and execution statistics.

**Messaging** — query conversation history (`query-messages`), scrape full threads
(`scrape-messaging-history`), and detect new replies (`check-replies`).

**Profile querying** — look up profiles by URL (`query-profile`) and search across
stored profiles (`query-profiles`).

**Action catalog** — `describe-actions` tool exposing all LinkedHelper action types
with configuration schemas.

**Infrastructure** — SPDX license headers with ESLint enforcement, Dependabot,
dependency license checks, npm provenance attestation, Codecov integration, GitHub Pages
docs site, and pinned GitHub Actions SHAs with job timeouts.

**Platform** — replaced `better-sqlite3` with Node.js built-in `node:sqlite`.

## Near-Term Priorities

Areas of focus after v0.2.0, in approximate priority order:

- **Operations layer extraction** (#264, #263) — reduce duplication between CLI and MCP
  by consolidating shared logic into core
- **Test coverage improvements** (#274) — strengthen shared test infrastructure and
  expand coverage across packages
- **Error hierarchy completion** (#269) — integrate remaining error types into the
  domain error hierarchy
- **Documentation completeness** (#276, #275, #277, #278, #285) — README accuracy,
  missing API docs, ADR updates
- **Security documentation** (#279, #280) — document CDP/MCP trust models and enhance
  remote-access security warnings

## Out of Scope (Near-Term)

Items explicitly not planned for the next 1-2 releases:

- **REST API interface** — the monorepo structure supports it, but not prioritized
- **Multi-account orchestration** — current design assumes single-account resolution
- **LinkedIn OAuth integration** — lhremote operates through LinkedHelper, not the
  LinkedIn API directly
- **GUI / web dashboard** — CLI and MCP are the supported interfaces
