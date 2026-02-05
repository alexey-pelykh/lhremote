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
 * A text node in the message template tree.
 */
export interface TextNode {
  type: "text";
  value: string;
}

/**
 * A variable node in the message template tree.
 */
export interface VarNode {
  type: "var";
  name: TemplateVariable;
}

/**
 * A group node containing child nodes.
 */
export interface GroupNode {
  type: "group";
  children: Array<TextNode | VarNode>;
}

/**
 * A variant node wrapping a group.
 */
export interface VariantNode {
  type: "variant";
  child: GroupNode;
}

/**
 * The root message template structure with variants.
 */
export interface MessageTemplate {
  type: "variants";
  variants: VariantNode[];
}

/**
 * Parse a user-friendly message template string into LinkedHelper's format.
 *
 * Converts `{variableName}` placeholders into the nested tree structure
 * expected by LinkedHelper's MessageToPerson action.
 *
 * @example
 * ```ts
 * parseMessageTemplate("Hi {firstName}, great to connect!")
 * // Returns: {
 * //   type: "variants",
 * //   variants: [{
 * //     type: "variant",
 * //     child: {
 * //       type: "group",
 * //       children: [
 * //         { type: "text", value: "Hi " },
 * //         { type: "var", name: "firstName" },
 * //         { type: "text", value: ", great to connect!" }
 * //       ]
 * //     }
 * //   }]
 * // }
 * ```
 *
 * @param text - Message text with optional `{variable}` placeholders
 * @returns MessageTemplate in LinkedHelper's expected format
 * @throws Error if an unknown variable is used
 */
export function parseMessageTemplate(text: string): MessageTemplate {
  const children: Array<TextNode | VarNode> = [];

  // Match {variableName} patterns
  const regex = /\{([^}]+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add the literal text before this variable (if any)
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      children.push({ type: "text", value: textBefore });
    }

    // Validate and add the variable
    const varName = match[1] as string;
    if (!TEMPLATE_VARIABLES.includes(varName as TemplateVariable)) {
      throw new Error(
        `Unknown template variable: ${varName}. ` +
          `Valid variables are: ${TEMPLATE_VARIABLES.join(", ")}`,
      );
    }
    children.push({ type: "var", name: varName as TemplateVariable });

    lastIndex = regex.lastIndex;
  }

  // Add any remaining text after the last variable
  const textAfter = text.slice(lastIndex);
  if (textAfter) {
    children.push({ type: "text", value: textAfter });
  }

  return {
    type: "variants",
    variants: [
      {
        type: "variant",
        child: {
          type: "group",
          children,
        },
      },
    ],
  };
}
