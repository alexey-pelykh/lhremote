import { describe, expect, it } from "vitest";

import {
  parseMessageTemplate,
  TEMPLATE_VARIABLES,
  type MessageTemplateSegment,
} from "./message-template.js";

describe("parseMessageTemplate", () => {
  it("parses plain text without variables", () => {
    const result = parseMessageTemplate("Hello, nice to meet you!");

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["Hello, nice to meet you!"],
        variables: [],
      },
    ]);
  });

  it("parses single variable", () => {
    const result = parseMessageTemplate("Hi {firstName}!");

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["Hi ", "!"],
        variables: ["firstName"],
      },
    ]);
  });

  it("parses multiple variables", () => {
    const result = parseMessageTemplate(
      "Hi {firstName}, I see you work at {company} as {position}.",
    );

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["Hi ", ", I see you work at ", " as ", "."],
        variables: ["firstName", "company", "position"],
      },
    ]);
  });

  it("parses all supported variables", () => {
    const result = parseMessageTemplate(
      "{firstName} {lastName} at {company} - {position} in {location}",
    );

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["", " ", " at ", " - ", " in ", ""],
        variables: ["firstName", "lastName", "company", "position", "location"],
      },
    ]);
  });

  it("handles empty string", () => {
    const result = parseMessageTemplate("");

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: [""],
        variables: [],
      },
    ]);
  });

  it("handles leading variable", () => {
    const result = parseMessageTemplate("{firstName}, how are you?");

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["", ", how are you?"],
        variables: ["firstName"],
      },
    ]);
  });

  it("handles trailing variable", () => {
    const result = parseMessageTemplate("Hello {firstName}");

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["Hello ", ""],
        variables: ["firstName"],
      },
    ]);
  });

  it("handles adjacent variables", () => {
    const result = parseMessageTemplate("{firstName}{lastName}");

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["", "", ""],
        variables: ["firstName", "lastName"],
      },
    ]);
  });

  it("handles variable-only message", () => {
    const result = parseMessageTemplate("{firstName}");

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["", ""],
        variables: ["firstName"],
      },
    ]);
  });

  it("preserves newlines and whitespace", () => {
    const result = parseMessageTemplate(
      "Hi {firstName},\n\nHope this finds you well.\n\nBest regards",
    );

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["Hi ", ",\n\nHope this finds you well.\n\nBest regards"],
        variables: ["firstName"],
      },
    ]);
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

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["", ", ", ", ", "!"],
        variables: ["firstName", "firstName", "firstName"],
      },
    ]);
  });

  it("handles special characters in text", () => {
    const result = parseMessageTemplate(
      "Hi {firstName}! Questions? Email: test@example.com (24/7)",
    );

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: [
          "Hi ",
          "! Questions? Email: test@example.com (24/7)",
        ],
        variables: ["firstName"],
      },
    ]);
  });

  it("handles unicode characters", () => {
    const result = parseMessageTemplate("Bonjour {firstName}! \u{1F44B}");

    expect(result).toEqual<MessageTemplateSegment[]>([
      {
        valueParts: ["Bonjour ", "! \u{1F44B}"],
        variables: ["firstName"],
      },
    ]);
  });
});
