// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH
//
// Build a self-contained ESM bundle of the lhremote MCP server.
//
// Usage:
//   node scripts/build-bundle.mjs
//
// Output: dist-bundle/lhremote-mcp.mjs
//
// The bundle includes all npm runtime dependencies.
// All node:* built-ins and any native .node modules remain external.
// Run `pnpm build` before this script to compile the TypeScript sources.

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const lhremotePkg = JSON.parse(
  readFileSync(join(root, "packages", "lhremote", "package.json"), "utf8"),
);
const version = lhremotePkg.version;

const outfile = join(root, "dist-bundle", "lhremote-mcp.mjs");

console.log(`Bundling lhremote ${version} → dist-bundle/lhremote-mcp.mjs`);

// esbuild's synthetic CJS shim (for bundled CJS deps like commander) does:
//   if (typeof require !== "undefined") return require(x);
// In ESM context, `require` is undefined by default. Injecting this banner
// defines a working `require` so CJS modules can load Node built-ins.
const requirePolyfillBanner =
  'import { createRequire as __createRequirePolyfill } from "module";\n' +
  'var require = __createRequirePolyfill(import.meta.url);\n';

const result = await build({
  entryPoints: [join(root, "packages", "lhremote", "dist", "cli.js")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node18"],
  outfile,
  // Keep all Node.js built-ins external — they are resolved at runtime.
  external: ["node:*"],
  banner: { js: requirePolyfillBanner },
  minifyIdentifiers: false,
  minifySyntax: true,
  sourcemap: false,
  define: {
    "__LHREMOTE_VERSION__": JSON.stringify(version),
  },
  logLevel: "warning",
});

if (result.errors.length > 0) {
  console.error("Bundle errors:", result.errors);
  process.exit(1);
}

console.log(`✓ Bundle written to dist-bundle/lhremote-mcp.mjs`);
