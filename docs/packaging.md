# Packaging — lhremote `.mcpb` extension

This document describes how to rebuild the self-contained MCP bundle and produce a new `.mcpb` Claude Desktop extension package.

## Prerequisites

```
pnpm install         # install workspace deps
pnpm build           # compile all TypeScript packages
```

Both commands must succeed before bundling.

## Step 1 — Rebuild the server bundle

```
node scripts/build-bundle.mjs
```

Output: `dist-bundle/lhremote-mcp.mjs`

The script bundles the compiled entry point (`packages/lhremote/dist/cli.js`) and all npm runtime dependencies into a single self-contained ESM file.  Node.js built-ins (`node:*`) remain external and are resolved at runtime.

**Run this any time TypeScript sources change.** The bundle captures code at build time, so a source change only takes effect after a rebuild + repack.

## Step 2 — Copy the bundle into the staging directory

```
copy dist-bundle\lhremote-mcp.mjs dist-mcpb-staging\lhremote-mcp.mjs
```

The staging directory (`dist-mcpb-staging/`) must contain exactly two files:

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (see below) |
| `lhremote-mcp.mjs` | The self-contained server bundle |

## Step 3 — Pack the `.mcpb` file

```
npx @anthropic-ai/mcpb pack dist-mcpb-staging dist-mcpb/lhremote-0.21.0.mcpb
```

Replace `0.21.0` with the current version string if needed.  The output file is a ZIP archive (`Content-Type: application/zip`) that Claude Desktop unpacks at install time.

## Step 4 — Install and restart Claude Desktop

1. Open **Claude Desktop → Settings → Extensions**.
2. Click **Uninstall** next to any prior `lhremote` extension.
3. Click **Install extension** and select the new `.mcpb` file.
4. **Fully quit** Claude Desktop (File → Quit / tray → Quit), then relaunch.
   A simple window close is not enough — the MCP server process must restart.

## Manifest notes

`dist-mcpb-staging/manifest.json` configures how Claude Desktop launches the server:

```json
"args": ["${__dirname}/lhremote-mcp.mjs", "mcp"]
```

`${__dirname}` is a template variable that Claude Desktop resolves to the **extension install directory** at runtime (e.g. `%APPDATA%\Claude\Claude Extensions\…`).  It is **not** a Node.js `__dirname`.

**Never point `args` at the working-tree path** (`C:\Users\…\insoftex-lhremote\…`).  That path is only valid on the developer machine and breaks on every other install.  The packed bundle is the only portable artifact.

## Quick rebuild checklist

```
pnpm build
node scripts/build-bundle.mjs
copy dist-bundle\lhremote-mcp.mjs dist-mcpb-staging\lhremote-mcp.mjs
npx @anthropic-ai/mcpb pack dist-mcpb-staging dist-mcpb/lhremote-<version>.mcpb
```

Then reinstall the new `.mcpb` and restart Claude Desktop.

## Version bumps

Before publishing a new release, update the version in all required files (see CLAUDE.md § Versioning), then rebuild and repack.  The manifest version in `dist-mcpb-staging/manifest.json` and the root `packages/lhremote/package.json` must agree, as the bundle script reads the latter to stamp `__LHREMOTE_VERSION__` at build time.
