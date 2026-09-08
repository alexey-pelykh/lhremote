#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { runStdioBin } from "./run.js";

// `void`, not top-level await.  `runStdioBin` handles its own rejection, so
// there is nothing here to await for correctness, and leaving this module
// synchronous costs nothing.
//
// The reason `packages/{cli,lhremote}/src/cli.ts` give for the same idiom is
// NOT the reason here, and must not be copied in: those files are what their
// package's `exports["."]` resolves to, so a top-level await there breaks
// `require()` of the package (ERR_REQUIRE_ASYNC_MODULE).  This package points
// `exports["."]` at `server.js` and reaches this file only through `bin`, and
// `./dist/index.js` is not a declared subpath — measured: `require()` of it is
// refused with ERR_PACKAGE_PATH_NOT_EXPORTED.  Nothing can `require()` this.
//
// What `void` does depend on is the catch inside `runStdioBin`: a `void` over
// a function that let its own rejection escape would exit 0 with an empty
// stderr under `--unhandled-rejections=none` — measured, and a silent success
// for a server that never started.  The two go together (#945).
void runStdioBin();
