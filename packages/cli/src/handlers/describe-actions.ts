import {
  type ActionTypeInfo,
  getActionTypeCatalog,
  getActionTypeInfo,
} from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#utilities | describe-actions} CLI command. */
export function handleDescribeActions(options: {
  category?: string;
  type?: string;
  json?: boolean;
}): void {
  // Single action type lookup
  if (options.type !== undefined) {
    const info = getActionTypeInfo(options.type);
    if (info === undefined) {
      process.stderr.write(`Unknown action type: ${options.type}\n`);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(info, null, 2) + "\n");
    } else {
      printActionTypeDetail(info);
    }
    return;
  }

  // Catalog listing
  const validCategories = ["people", "messaging", "engagement", "crm", "workflow"] as const;
  type ValidCategory = (typeof validCategories)[number];

  function isValidCategory(value: string): value is ValidCategory {
    return (validCategories as readonly string[]).includes(value);
  }

  let category: ValidCategory | undefined;
  if (options.category !== undefined) {
    if (!isValidCategory(options.category)) {
      process.stderr.write(
        `Invalid category: ${options.category}. Valid categories: ${validCategories.join(", ")}\n`,
      );
      process.exitCode = 1;
      return;
    }
    category = options.category;
  }

  const catalog = getActionTypeCatalog(category);

  if (options.json) {
    process.stdout.write(JSON.stringify(catalog, null, 2) + "\n");
  } else {
    if (catalog.actionTypes.length === 0) {
      process.stdout.write("No action types found.\n");
      return;
    }

    const heading = category !== undefined
      ? `Action types in "${category}" (${String(catalog.actionTypes.length)}):`
      : `All action types (${String(catalog.actionTypes.length)}):`;
    process.stdout.write(heading + "\n\n");

    for (const info of catalog.actionTypes) {
      process.stdout.write(`  ${info.name}  [${info.category}]\n`);
      process.stdout.write(`    ${info.description}\n\n`);
    }
  }
}

function printActionTypeDetail(info: ActionTypeInfo): void {
  process.stdout.write(`${info.name}  [${info.category}]\n`);
  process.stdout.write(`${info.description}\n\n`);

  const fields = Object.entries(info.configSchema);
  if (fields.length > 0) {
    process.stdout.write("Configuration:\n");
    for (const [name, field] of fields) {
      const req = field.required ? "required" : "optional";
      const def = field.default !== undefined ? `, default: ${JSON.stringify(field.default)}` : "";
      process.stdout.write(`  ${name} (${field.type}, ${req}${def})\n`);
      process.stdout.write(`    ${field.description}\n`);
    }
    process.stdout.write("\n");
  }

  if (info.example !== undefined) {
    process.stdout.write("Example:\n");
    process.stdout.write(JSON.stringify(info.example, null, 2) + "\n");
  }
}
