// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  randomDelay: vi.fn().mockResolvedValue(undefined),
  randomBetween: vi.fn().mockReturnValue(0),
  gaussianRandom: vi.fn().mockReturnValue(0),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
  gaussianBetween: vi.fn().mockReturnValue(0),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
  maybeBreak: vi.fn().mockResolvedValue(undefined),
}));

import type { CDPClient } from "../cdp/client.js";
import { typeTextWithMentions } from "./dom-automation.js";

function createMockClient(options?: {
  mentionMatchIndex?: number;
}): CDPClient {
  const matchIndex = options?.mentionMatchIndex ?? 0;

  return {
    evaluate: vi.fn().mockImplementation((expr: string) => {
      // Handle focus check
      if (expr.includes("el.focus()")) return Promise.resolve(true);
      // Handle mention match search
      if (expr.includes("options.length")) return Promise.resolve(matchIndex);
      return Promise.resolve(true);
    }),
    send: vi.fn().mockResolvedValue(undefined),
  } as unknown as CDPClient;
}

// Mock waitForElement at the module level since typeTextWithMentions calls it
vi.mock("./selectors.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./selectors.js")>();
  return actual;
});

describe("typeTextWithMentions", () => {
  it("delegates to typeText when mentions array is empty", async () => {
    const client = createMockClient();

    await typeTextWithMentions(client, ".editor", "Hello world", []);

    // typeText focuses the element and dispatches key events
    expect(client.evaluate).toHaveBeenCalled();
    // No ArrowDown/Enter dispatched (no mention interaction)
    const sendCalls = vi.mocked(client.send).mock.calls;
    const arrowDownCalls = sendCalls.filter(
      (c) => c[1] && (c[1] as { key?: string }).key === "ArrowDown",
    );
    expect(arrowDownCalls).toHaveLength(0);
  });

  it("types @ and mention name, then selects via ArrowDown+Enter", async () => {
    const client = createMockClient({ mentionMatchIndex: 0 });

    await typeTextWithMentions(client, ".editor", "Hello @John Doe!", [
      { name: "John Doe" },
    ]);

    const sendCalls = vi.mocked(client.send).mock.calls;

    // Should have dispatched @ character
    const atCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { text?: string }).text === "@",
    );
    expect(atCalls.length).toBeGreaterThan(0);

    // Should have dispatched ArrowDown (once for index 0)
    const arrowCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "ArrowDown",
    );
    expect(arrowCalls.length).toBeGreaterThanOrEqual(1);

    // Should have dispatched Enter to select
    const enterCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "Enter",
    );
    expect(enterCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("handles multiple mentions in text", async () => {
    const client = createMockClient({ mentionMatchIndex: 0 });

    await typeTextWithMentions(
      client,
      ".editor",
      "@Alice and @Bob hello",
      [{ name: "Alice" }, { name: "Bob" }],
    );

    const sendCalls = vi.mocked(client.send).mock.calls;

    // Check for Enter dispatches (one per mention selection)
    const enterCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "Enter",
    );
    // 2 mentions = 2 Enter key pairs (keyDown + keyUp each)
    expect(enterCalls).toHaveLength(4);
  });

  it("throws when mention not found in typeahead", async () => {
    const client = createMockClient({ mentionMatchIndex: -1 });

    await expect(
      typeTextWithMentions(client, ".editor", "@Nobody here", [
        { name: "Nobody" },
      ]),
    ).rejects.toThrow('Mention "Nobody" not found in typeahead results');

    // Should have dispatched Escape to dismiss typeahead
    const sendCalls = vi.mocked(client.send).mock.calls;
    const escapeCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "Escape",
    );
    expect(escapeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("types plain text when no @Name tokens match mentions", async () => {
    const client = createMockClient();

    await typeTextWithMentions(client, ".editor", "Hello world", [
      { name: "John Doe" },
    ]);

    // No ArrowDown/Enter dispatched — fell through to plain typeText
    const sendCalls = vi.mocked(client.send).mock.calls;
    const arrowCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "ArrowDown",
    );
    expect(arrowCalls).toHaveLength(0);
  });

  it("navigates with ArrowDown to non-first match", async () => {
    const client = createMockClient({ mentionMatchIndex: 2 });

    await typeTextWithMentions(client, ".editor", "@Jane Smith ok", [
      { name: "Jane Smith" },
    ]);

    const sendCalls = vi.mocked(client.send).mock.calls;
    // Should ArrowDown 3 times (0, 1, 2) for index 2
    const arrowDownCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "ArrowDown" &&
        (c[1] as { type?: string }).type === "keyDown",
    );
    expect(arrowDownCalls).toHaveLength(3);
  });

  it("handles mention at start of text", async () => {
    const client = createMockClient({ mentionMatchIndex: 0 });

    await typeTextWithMentions(client, ".editor", "@Alice hello", [
      { name: "Alice" },
    ]);

    // Should focus the element first
    expect(client.evaluate).toHaveBeenCalled();
    const focusCalls = vi.mocked(client.evaluate).mock.calls.filter((c) =>
      (c[0] as string).includes("focus"),
    );
    expect(focusCalls.length).toBeGreaterThan(0);
  });

  it("matches longest mention first to avoid substring collisions", async () => {
    const client = createMockClient({ mentionMatchIndex: 0 });

    await typeTextWithMentions(
      client,
      ".editor",
      "@Alex and @Al hello",
      [{ name: "Al" }, { name: "Alex" }],
    );

    const sendCalls = vi.mocked(client.send).mock.calls;
    // Both mentions should be resolved (2 Enter pairs = 4 events)
    const enterCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "Enter",
    );
    expect(enterCalls).toHaveLength(4);

    // The evaluate calls for matching should search for "Alex" first
    // (longest match), then "Al"
    const matchCalls = vi.mocked(client.evaluate).mock.calls.filter((c) =>
      (c[0] as string).includes("options.length"),
    );
    expect(matchCalls).toHaveLength(2);
  });

  it("requires boundary between adjacent mentions", async () => {
    const client = createMockClient({ mentionMatchIndex: 0 });

    // @Alice@Bob: the second @ is preceded by 'e' (a word char), so
    // @Bob is NOT recognized as a mention (boundary check fails).
    // Only @Alice is resolved.
    await typeTextWithMentions(
      client,
      ".editor",
      "@Alice@Bob",
      [{ name: "Alice" }, { name: "Bob" }],
    );

    const sendCalls = vi.mocked(client.send).mock.calls;
    const enterCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "Enter",
    );
    // Only @Alice resolved (1 Enter pair = 2 events)
    expect(enterCalls).toHaveLength(2);
  });

  it("resolves both mentions when separated by a space", async () => {
    const client = createMockClient({ mentionMatchIndex: 0 });

    await typeTextWithMentions(
      client,
      ".editor",
      "@Alice @Bob",
      [{ name: "Alice" }, { name: "Bob" }],
    );

    const sendCalls = vi.mocked(client.send).mock.calls;
    const enterCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "Enter",
    );
    // Both resolved (2 Enter pairs = 4 events)
    expect(enterCalls).toHaveLength(4);
  });

  it("handles mention at end of text", async () => {
    const client = createMockClient({ mentionMatchIndex: 0 });

    await typeTextWithMentions(client, ".editor", "hello @Alice", [
      { name: "Alice" },
    ]);

    // Should type "hello " before the mention and nothing after
    const sendCalls = vi.mocked(client.send).mock.calls;
    const enterCalls = sendCalls.filter(
      (c) =>
        c[0] === "Input.dispatchKeyEvent" &&
        (c[1] as { key?: string }).key === "Enter",
    );
    expect(enterCalls.length).toBeGreaterThanOrEqual(1);
  });
});
