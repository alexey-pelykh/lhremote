# Roadmap

This is a living document. Timelines are approximate and priorities may shift as the
project evolves. For the latest changes, see [CHANGELOG.md](CHANGELOG.md).

## Latest Release: v0.2.0

A major capability expansion over v0.1.0, adding full campaign lifecycle management,
messaging tools, and significant infrastructure hardening. See
[CHANGELOG.md](CHANGELOG.md) for full details.

## Near-Term Priorities

Areas of focus after v0.2.0, in approximate priority order:

- **Remote connection support** — extend beyond same-machine limitation with secure
  remote CDP connections
- **Multi-account orchestration** — support managing multiple LinkedIn accounts in a
  single session
- **Webhook/event notifications** — push-based notifications for campaign status changes
  and new message replies

## Out of Scope (Near-Term)

Items explicitly not planned for the next 1-2 releases:

- **REST API interface** — the monorepo structure supports it, but not prioritized
- **Multi-account orchestration** — current design assumes single-account resolution
- **LinkedIn OAuth integration** — lhremote operates through LinkedHelper, not the
  LinkedIn API directly
- **GUI / web dashboard** — CLI and MCP are the supported interfaces
