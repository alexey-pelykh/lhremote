#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { createProgram, runProgram } from "./program.js";

await runProgram(createProgram());
