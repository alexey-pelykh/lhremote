/**
 * Available template variables for LinkedIn messages.
 */
export const TEMPLATE_VARIABLES = [
  "firstName",
  "lastName",
  "company",
  "position",
  "location",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/**
 * A single message template segment in LinkedHelper's format.
 *
 * The `valueParts` array contains literal text segments, and `variables`
 * contains the variable names that appear between those segments.
 *
 * For a message "Hi {firstName}, from {company}!", the structure would be:
 * - valueParts: ["Hi ", ", from ", "!"]
 * - variables: ["firstName", "company"]
 */
export interface MessageTemplateSegment {
  valueParts: string[];
  variables: TemplateVariable[];
}

/**
 * Parse a user-friendly message template string into LinkedHelper's format.
 *
 * Converts `{variableName}` placeholders into the `valueParts` + `variables`
 * structure expected by LinkedHelper's MessageToPerson action.
 *
 * @example
 * ```ts
 * parseMessageTemplate("Hi {firstName}, great to connect!")
 * // Returns: [{
 * //   valueParts: ["Hi ", ", great to connect!"],
 * //   variables: ["firstName"]
 * // }]
 * ```
 *
 * @param text - Message text with optional `{variable}` placeholders
 * @returns Array with a single MessageTemplateSegment
 * @throws Error if an unknown variable is used
 */
export function parseMessageTemplate(text: string): MessageTemplateSegment[] {
  const valueParts: string[] = [];
  const variables: TemplateVariable[] = [];

  // Match {variableName} patterns
  const regex = /\{([^}]+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add the literal text before this variable
    valueParts.push(text.slice(lastIndex, match.index));

    // Validate and add the variable
    const varName = match[1] as string;
    if (!TEMPLATE_VARIABLES.includes(varName as TemplateVariable)) {
      throw new Error(
        `Unknown template variable: ${varName}. ` +
          `Valid variables are: ${TEMPLATE_VARIABLES.join(", ")}`,
      );
    }
    variables.push(varName as TemplateVariable);

    lastIndex = regex.lastIndex;
  }

  // Add any remaining text after the last variable
  valueParts.push(text.slice(lastIndex));

  return [{ valueParts, variables }];
}
