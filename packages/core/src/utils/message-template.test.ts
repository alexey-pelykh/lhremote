import { describe, expect, it } from "vitest";

import {
  parseMessageTemplate,
  TEMPLATE_VARIABLES,
  type MessageTemplate,
} from "./message-template.js";

describe("parseMessageTemplate", () => {
  it("parses plain text without variables", () => {
    const result = parseMessageTemplate("Hello, nice to meet you!");

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [{ type: "text", value: "Hello, nice to meet you!" }],
          },
        },
      ],
    });
  });

  it("parses single variable", () => {
    const result = parseMessageTemplate("Hi {firstName}!");

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "text", value: "Hi " },
              { type: "var", name: "firstName" },
              { type: "text", value: "!" },
            ],
          },
        },
      ],
    });
  });

  it("parses multiple variables", () => {
    const result = parseMessageTemplate(
      "Hi {firstName}, I see you work at {company} as {position}.",
    );

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "text", value: "Hi " },
              { type: "var", name: "firstName" },
              { type: "text", value: ", I see you work at " },
              { type: "var", name: "company" },
              { type: "text", value: " as " },
              { type: "var", name: "position" },
              { type: "text", value: "." },
            ],
          },
        },
      ],
    });
  });

  it("parses all supported variables", () => {
    const result = parseMessageTemplate(
      "{firstName} {lastName} at {company} - {position} in {location}",
    );

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "var", name: "firstName" },
              { type: "text", value: " " },
              { type: "var", name: "lastName" },
              { type: "text", value: " at " },
              { type: "var", name: "company" },
              { type: "text", value: " - " },
              { type: "var", name: "position" },
              { type: "text", value: " in " },
              { type: "var", name: "location" },
            ],
          },
        },
      ],
    });
  });

  it("handles empty string", () => {
    const result = parseMessageTemplate("");

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [],
          },
        },
      ],
    });
  });

  it("handles leading variable", () => {
    const result = parseMessageTemplate("{firstName}, how are you?");

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "var", name: "firstName" },
              { type: "text", value: ", how are you?" },
            ],
          },
        },
      ],
    });
  });

  it("handles trailing variable", () => {
    const result = parseMessageTemplate("Hello {firstName}");

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "text", value: "Hello " },
              { type: "var", name: "firstName" },
            ],
          },
        },
      ],
    });
  });

  it("handles adjacent variables", () => {
    const result = parseMessageTemplate("{firstName}{lastName}");

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "var", name: "firstName" },
              { type: "var", name: "lastName" },
            ],
          },
        },
      ],
    });
  });

  it("handles variable-only message", () => {
    const result = parseMessageTemplate("{firstName}");

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [{ type: "var", name: "firstName" }],
          },
        },
      ],
    });
  });

  it("preserves newlines and whitespace", () => {
    const result = parseMessageTemplate(
      "Hi {firstName},\n\nHope this finds you well.\n\nBest regards",
    );

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "text", value: "Hi " },
              { type: "var", name: "firstName" },
              {
                type: "text",
                value: ",\n\nHope this finds you well.\n\nBest regards",
              },
            ],
          },
        },
      ],
    });
  });

  it("throws error for unknown variable", () => {
    expect(() => parseMessageTemplate("Hello {unknown}!")).toThrow(
      "Unknown template variable: unknown",
    );
  });

  it("throws error with list of valid variables", () => {
    expect(() => parseMessageTemplate("{badVar}")).toThrow(
      `Valid variables are: ${TEMPLATE_VARIABLES.join(", ")}`,
    );
  });

  it("handles duplicate variables", () => {
    const result = parseMessageTemplate(
      "{firstName}, {firstName}, {firstName}!",
    );

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "var", name: "firstName" },
              { type: "text", value: ", " },
              { type: "var", name: "firstName" },
              { type: "text", value: ", " },
              { type: "var", name: "firstName" },
              { type: "text", value: "!" },
            ],
          },
        },
      ],
    });
  });

  it("handles special characters in text", () => {
    const result = parseMessageTemplate(
      "Hi {firstName}! Questions? Email: test@example.com (24/7)",
    );

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "text", value: "Hi " },
              { type: "var", name: "firstName" },
              {
                type: "text",
                value: "! Questions? Email: test@example.com (24/7)",
              },
            ],
          },
        },
      ],
    });
  });

  it("handles unicode characters", () => {
    const result = parseMessageTemplate("Bonjour {firstName}! \u{1F44B}");

    expect(result).toEqual<MessageTemplate>({
      type: "variants",
      variants: [
        {
          type: "variant",
          child: {
            type: "group",
            children: [
              { type: "text", value: "Bonjour " },
              { type: "var", name: "firstName" },
              { type: "text", value: "! \u{1F44B}" },
            ],
          },
        },
      ],
    });
  });
});
