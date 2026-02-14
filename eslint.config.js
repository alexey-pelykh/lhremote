// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import headerPlugin from "eslint-plugin-header";

// Workaround: eslint-plugin-header lacks meta.schema, which ESLint >=9.4
// treats as "no options allowed". Setting schema to false disables validation.
// See https://github.com/Stuk/eslint-plugin-header/issues/57
headerPlugin.rules.header.meta ??= {};
headerPlugin.rules.header.meta.schema = false;

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  eslintConfigPrettier,
  {
    ignores: ["**/dist/"],
  },
  {
    plugins: {
      header: headerPlugin,
    },
    rules: {
      "header/header": [
        "error",
        "line",
        [
          " SPDX-License-Identifier: AGPL-3.0-only",
          " Copyright (C) 2025-2026 Alexey Pelykh",
        ],
      ],
    },
  },
);
