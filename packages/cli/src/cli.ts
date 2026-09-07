#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { createProgram, runProgram } from "./program.js";

// `void`, not top-level await.  `runProgram` handles its own rejection, so
// there is nothing here to await for correctness — and awaiting would make
// this module async, which breaks `require()` of any package whose `exports`
// resolve to this file (measured: ERR_REQUIRE_ASYNC_MODULE).
void runProgram(createProgram());
