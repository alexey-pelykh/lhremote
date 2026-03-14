// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import headerPlugin from "@tony.ganchev/eslint-plugin-header";

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
          " Copyright (C) 2026 Oleksii PELYKH",
        ],
      ],
    },
  },
);
