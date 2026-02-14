# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in lhremote, please report it
responsibly by emailing **alexey.pelykh@gmail.com**. Do not open a public
issue.

You should receive a response within 48 hours. Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept.
- The version of lhremote you tested against.

## Security Model

### Localhost Trust Boundary

lhremote communicates with LinkedHelper via the
[Chrome DevTools Protocol (CDP)](https://chromedevtools.github.io/devtools-protocol/).
All CDP connections use **unencrypted WebSocket (`ws://`)** with **no
authentication**. This is inherent to the CDP protocol.

The security boundary is the **loopback network interface** (`127.0.0.1` /
`::1`). By default, lhremote only connects to localhost and rejects
non-loopback addresses unless the caller explicitly opts in with the
`allowRemote` option (or the `--allow-remote` CLI / MCP flag).

**Threat model assumptions:**

| Assumption | Rationale |
|------------|-----------|
| The local machine is trusted | CDP has no authentication; any process on the same host can connect |
| The CDP port is not exposed to the network | Binding CDP to `0.0.0.0` or forwarding the port would allow remote code execution |
| LinkedHelper is a trusted application | lhremote executes JavaScript in its Electron renderer via `Runtime.evaluate` |

### CDP Access Implications

A CDP connection grants **full Electron renderer access**, equivalent to
opening DevTools on the application. This means:

- **Arbitrary JavaScript execution** in the renderer process via
  `Runtime.evaluate`.
- **Credential proximity**: CDP can read anything the application can read,
  including the Electron store (which contains account data such as LinkedIn
  passwords stored by LinkedHelper).
- **Navigation control**: CDP can navigate the browser to any URL.
- **DOM access**: CDP can read and modify page content.

These capabilities are inherent to CDP-based automation and are **by design**.
lhremote does not add or remove any capability beyond what DevTools already
provides.

### MCP Trust Model

lhremote exposes an [MCP](https://modelcontextprotocol.io/) server
(`lhremote mcp`) that gives AI agents and other MCP clients programmatic
access to LinkedHelper.

#### Transport

The MCP server uses **stdio transport**. The MCP client (e.g., Claude
Desktop) spawns `lhremote mcp` as a child process and communicates over
stdin/stdout — no network listener, no authentication token. The trust
boundary is **process-level**: any process that can spawn `lhremote mcp`
gets full access to every registered tool.

#### Tool Surface

32 tools are registered via `registerAllTools()` in
`packages/mcp/src/tools/index.ts`. They fall into three risk tiers:

| Tier | Tools |
|------|-------|
| **Read-only** (no side effects) | `check-status`, `find-app`, `list-accounts`, `query-profile`, `query-profiles`, `query-messages`, `campaign-get`, `campaign-list`, `campaign-export`, `campaign-statistics`, `campaign-status`, `campaign-exclude-list`, `describe-actions`, `check-replies` |
| **State-changing** (modifies LinkedHelper state) | `launch-app`, `quit-app`, `start-instance`, `stop-instance`, `campaign-create`, `campaign-update`, `campaign-start`, `campaign-stop`, `campaign-retry`, `campaign-move-next`, `campaign-add-action`, `campaign-remove-action`, `campaign-reorder-actions`, `campaign-exclude-add`, `campaign-exclude-remove`, `import-people-from-urls`, `scrape-messaging-history` |
| **Destructive** (permanent data loss) | `campaign-delete` |

All 32 tools are available to any connected MCP client with equal
privilege. There is no per-tool access control or rate limiting.

#### Prompt Injection Risk

When the MCP client is an AI agent, the agent processes **untrusted
data** from LinkedIn — profiles, messages, and connection requests. An
adversarial LinkedIn message could contain instructions that influence
the agent to invoke state-changing or destructive tools. This is a
threat vector unique to the MCP interface: the CDP interface has no
natural-language interpretation layer.

#### `allowRemote` Interaction

When `--allow-remote` is enabled, MCP tools connect to CDP endpoints on
remote hosts. This extends the trust boundary from localhost to the
network for **all 32 tools** — a remote MCP client gains the same tool
access as a local one, over an unauthenticated CDP connection.

### Recommendations

- **Do not expose the CDP port to the network.** Keep the default host
  (`127.0.0.1`) and do not forward the port through SSH tunnels, Docker
  port mappings, or firewall rules.
- **Do not use `--allow-remote`** unless you understand the implications
  and have secured the network path (e.g., mutual TLS via a reverse proxy).
- **Do not grant MCP access to untrusted AI agents.** Any MCP client
  that can spawn `lhremote mcp` receives full access to all 32 tools,
  including destructive operations.
- **Review agent tool calls for destructive operations.** When using an
  AI agent as the MCP client, monitor its actions — especially
  `campaign-delete` and other state-changing tools.
- **Do not combine `--allow-remote` with AI agent MCP clients** unless
  the network path is secured. This combination extends unauthenticated
  tool access to remote CDP endpoints under AI-agent control.
- **Treat the machine running LinkedHelper as a trusted workstation.** Any
  local process can connect to the CDP port.
- **Keep LinkedHelper and lhremote up to date** to benefit from any
  security fixes.

## Supported Versions

Security fixes are applied to the latest release only. There is no
long-term support for older versions.
