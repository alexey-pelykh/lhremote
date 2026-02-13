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

### Recommendations

- **Do not expose the CDP port to the network.** Keep the default host
  (`127.0.0.1`) and do not forward the port through SSH tunnels, Docker
  port mappings, or firewall rules.
- **Do not use `--allow-remote`** unless you understand the implications
  and have secured the network path (e.g., mutual TLS via a reverse proxy).
- **Treat the machine running LinkedHelper as a trusted workstation.** Any
  local process can connect to the CDP port.
- **Keep LinkedHelper and lhremote up to date** to benefit from any
  security fixes.

## Supported Versions

Security fixes are applied to the latest release only. There is no
long-term support for older versions.
