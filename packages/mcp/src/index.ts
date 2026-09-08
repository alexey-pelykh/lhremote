#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { runStdioBin } from "./run.js";

// `void`, not top-level await.  `runStdioBin` handles its own rejection, so
// there is nothing here to await for correctness, and leaving this module
// synchronous costs nothing.
//
// The reason `packages/{cli,lhremote}/src/cli.ts` give for the same idiom is
// NOT the reason here, and must not be copied in.  Both state it as a
// conditional — "any package whose `exports` resolve to this file" — and the
// condition holds for exactly one of them: `packages/lhremote`'s `exports["."]`
// and its `bin` are both `./dist/cli.js`, so a top-level await there really
// does break `require()` of the package (ERR_REQUIRE_ASYNC_MODULE).
// `packages/cli` points `exports["."]` at `./dist/program.js` and reaches
// `cli.js` only through `bin` — the same position this file is in.  So does
// this one: `exports["."]` is `server.js`, `./dist/index.js` is not a declared
// subpath, and `require()` of it is refused with ERR_PACKAGE_PATH_NOT_EXPORTED
// (measured).  Do not flatten that conditional into a claim about both files.
//
// What `void` does depend on is the catch inside `runStdioBin`: a `void` over
// a function that let its own rejection escape would exit 0 with an empty
// stderr under `--unhandled-rejections=none` — measured, and a silent success
// for a server that never started.  The two go together (#945).
void runStdioBin();
