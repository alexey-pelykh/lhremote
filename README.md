# lhremote: LinkedHelper Automation Toolkit

[![npm version](https://img.shields.io/npm/v/lhremote?logo=npm)](https://www.npmjs.com/package/lhremote)
[![npm downloads](https://img.shields.io/npm/dm/lhremote?logo=npm)](https://www.npmjs.com/package/lhremote)
[![GitHub Repo stars](https://img.shields.io/github/stars/alexey-pelykh/lhremote?style=flat&logo=github)](https://github.com/alexey-pelykh/lhremote)
[![License](https://img.shields.io/github/license/alexey-pelykh/lhremote)](LICENSE)

CLI and MCP server for [LinkedHelper](https://linkedhelper.com) automation.

This project is brought to you by [Alexey Pelykh](https://github.com/alexey-pelykh).

## What It Does

lhremote lets AI assistants (Claude, etc.) control LinkedHelper through the [Model Context Protocol](https://modelcontextprotocol.io). It can:

- Detect running LinkedHelper instances and their CDP connection details
- Launch and quit the LinkedHelper application
- List configured LinkedIn accounts
- Start and stop LinkedHelper instances
- Visit LinkedIn profiles and extract structured data (name, positions, education, skills, emails)
- Check connection status, running instances, and database health

## Prerequisites

- **Node.js** >= 22
- **LinkedHelper** desktop application (requires a paid subscription)

## Installation

```sh
npm install -g lhremote
```

Or run directly with npx:

```sh
npx lhremote --help
```

## Usage with Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
    "mcpServers": {
        "lhremote": {
            "command": "npx",
            "args": ["lhremote", "mcp"]
        }
    }
}
```

Once configured, Claude can use the tools directly. A typical workflow:

1. **`find-app`** - Detect a running LinkedHelper instance (or **`launch-app`** to start one)
2. **`list-accounts`** - See available LinkedIn accounts
3. **`start-instance`** - Start an instance for an account
4. **`visit-and-extract`** - Visit a profile and get structured data
5. **`stop-instance`** - Stop the instance when done
6. **`quit-app`** - Quit LinkedHelper

## CLI Usage

The `lhremote` command provides the same functionality as the MCP server:

```sh
lhremote find-app [--json]
lhremote launch-app [--cdp-port <port>]
lhremote quit-app [--cdp-port <port>]
lhremote list-accounts [--cdp-port <port>] [--json]
lhremote start-instance <accountId> [--cdp-port <port>]
lhremote stop-instance <accountId> [--cdp-port <port>]
lhremote visit-and-extract <profileUrl> [--cdp-port <port>] [--json]
lhremote check-status [--cdp-port <port>] [--json]
```

## MCP Tools

### `find-app`

Detect running LinkedHelper application instances and their CDP connection details. Useful when the app is already running and you need to discover which port to connect on.

*No parameters.*

Returns an array of discovered instances, each with `pid`, `cdpPort`, and `connectable` status.

### `launch-app`

Launch the LinkedHelper application with remote debugging enabled.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cdpPort` | number | No | auto-select | CDP port to use |

### `quit-app`

Quit the LinkedHelper application.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cdpPort` | number | No | 9222 | CDP port |

### `list-accounts`

List available LinkedHelper accounts. Returns account ID, LinkedIn ID, name, and email for each account.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cdpPort` | number | No | 9222 | CDP port |

### `start-instance`

Start a LinkedHelper instance for a LinkedIn account. Required before `visit-and-extract`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `accountId` | number | No | auto-select if single account | Account ID |
| `cdpPort` | number | No | 9222 | CDP port |

### `stop-instance`

Stop a running LinkedHelper instance.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `accountId` | number | No | auto-select if single account | Account ID |
| `cdpPort` | number | No | 9222 | CDP port |

### `visit-and-extract`

Visit a LinkedIn profile via LinkedHelper and extract all available data (name, positions, education, skills, emails). Requires a running instance.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `profileUrl` | string | Yes | - | LinkedIn profile URL (e.g., `https://www.linkedin.com/in/username`) |
| `cdpPort` | number | No | 9222 | CDP port |

### `check-status`

Check LinkedHelper connection status, running instances, and database health.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cdpPort` | number | No | 9222 | CDP port |

## Known Limitations

- **Single account for visit-and-extract**: When multiple accounts are configured, `visit-and-extract` cannot select which account to use. Use `start-instance` with an explicit `accountId` first.
- **Platform support**: LinkedHelper runs on macOS, Windows, and Linux. Binary paths are detected automatically but can be overridden with the `LINKEDHELPER_PATH` environment variable.
- **Instance startup time**: Starting an instance loads LinkedIn, which may take up to 45 seconds.

## Troubleshooting

### LinkedHelper is not running

**Error**: `LinkedHelper is not running (no CDP endpoint at port 9222)`

**Solution**: Use `launch-app` to start LinkedHelper, or start it manually. lhremote communicates with LinkedHelper via the Chrome DevTools Protocol (CDP), which requires the application to be running.

### Application binary not found

**Error**: `LinkedHelper application binary not found. Set LINKEDHELPER_PATH to override.`

**Solution**: Install LinkedHelper from [linkedhelper.com](https://linkedhelper.com). If installed in a non-standard location, set the `LINKEDHELPER_PATH` environment variable to the binary path.

### No accounts found

**Error**: `No accounts found.`

**Solution**: Open LinkedHelper and configure at least one LinkedIn account before using lhremote.

### Multiple accounts found

**Error**: `Multiple accounts found. Specify accountId. Use list-accounts to see available accounts.`

**Solution**: Use `list-accounts` to see available accounts, then pass the desired `accountId` to `start-instance`, `stop-instance`, or other tools.

### No instance running

**Error**: `No LinkedHelper instance is running. Use start-instance first.`

**Solution**: Run `start-instance` before using `visit-and-extract`. An instance must be running to interact with LinkedIn.

### Instance initialization timeout

**Error**: `Instance started but failed to initialize within timeout.`

**Solution**: The instance was started but took too long to finish loading. This can happen on slow connections. Try again; the instance may still be starting in the background. Use `check-status` to verify.

### Profile extraction timeout

**Error**: `Profile extraction timed out. The profile may not have loaded correctly.`

**Solution**: The LinkedIn profile page did not load within the expected time. Check that the profile URL is valid and that LinkedIn is accessible from the LinkedHelper instance. Try again.

### Database not found

**Error**: `No database found for account`

**Solution**: The LinkedHelper database file is missing for the specified account. Ensure the account has been used at least once in LinkedHelper so that a local database has been created.

## Disclaimer

`lhremote` is an **independent project** not affiliated with, endorsed by, or officially connected to:

- **LinkedIn** or LinkedIn Corporation
- **LinkedHelper** or its parent company

LinkedIn is a trademark of LinkedIn Corporation. LinkedHelper is a trademark of its respective owner.

## Purpose

This project enables **interoperability** between automation tools and LinkedHelper, as permitted under DMCA § 1201(f). Implementation is based on publicly observable behavior (Chrome DevTools Protocol) without access to protected source code.

## What This Project Does NOT Do

- Circumvent copy protection or licensing
- Bypass LinkedHelper authentication
- Enable use without a valid LinkedHelper subscription
- Provide access to LinkedIn without LinkedHelper

## User Responsibility

Use of `lhremote` requires a valid LinkedHelper subscription and is subject to LinkedHelper's and LinkedIn's terms of service. Users accept all responsibility for compliance.

## Ethical Use

This tool is for **legitimate productivity**. Do NOT use for spam, scraping at scale, or harassment.

## License

[AGPL-3.0-only](LICENSE) — For commercial licensing, contact the maintainer.
