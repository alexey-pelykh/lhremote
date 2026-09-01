// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// Diagnostic capture on `getPostEngagers`' EXTRACTION-failure path (#835).
//
// Sibling of `get-post-extraction-diagnostics.test.ts`, and kept out of
// `get-post-engagers.test.ts` for the same reason: that file carries the #827
// extraction-contract oracle and is executor-uneditable by construction.
//
// Same widening, same argument: `waitForReactionsModal` has already returned
// green by the time this fails — the modal opened and rendered engager links
// — so a deadline-bound capture cannot see the contradiction that follows it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("./navigate-away.js", () => ({
  navigateAwayIf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/delay.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  gaussianDelay: vi.fn().mockResolvedValue(undefined),
  gaussianBetween: vi.fn().mockReturnValue(500),
  maybeHesitate: vi.fn().mockResolvedValue(undefined),
  maybeBreak: vi.fn().mockResolvedValue(undefined),
  simulateReadingTime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../linkedin/dom-automation.js", () => ({
  humanizedScrollTo: vi.fn().mockResolvedValue(undefined),
  humanizedClick: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}TESTABCDEF`),
  writeFile: vi.fn().mockResolvedValue(undefined),
  lstat: vi.fn().mockResolvedValue({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    mode: 0o700,
  }),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

import { writeFile } from "node:fs/promises";

import { discoverTargets } from "../cdp/discovery.js";
import { CDPClient } from "../cdp/client.js";
import { ExtractionFailedError } from "../services/errors.js";

// Dynamic import after the mocks are registered, matching the convention the
// sibling capture suites document: relying on vi.mock hoisting to cover a
// module that reaches `node:fs/promises` at load time is brittle under ESM
// transforms (`wait-for-post-load.test.ts` header).
const { getPostEngagers } = await import("./get-post-engagers.js");

describe("getPostEngagers extraction-failure diagnostics (#835)", () => {
  const CDP_PORT = 9222;
  const POST_URL =
    "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/";

  const CAPTURE_PROBE = {
    href: POST_URL,
    dialogCount: 1,
    dialogHasInLinks: true,
    dialogChildElementCount: 4,
    bodyTextSnippet: "2 reactions\n",
    reactionsButtonAriaLabels: ["Open reactions menu"],
    reactionsCountText: "2 reactions",
    htmlDialogCount: 1,
    ariaModalCount: 1,
    hasReactionsTab: true,
    reactionsTabAncestorChain: ["div role=dialog inLinks=0"],
    resolvedModalAncestorTag: "div",
  };

  // The probe above reports an OPEN modal, and that is only honest because
  // the corroboration check runs before the Escape dispatch that dismisses it
  // (#835).  Were the capture to run after dismissal it would record
  // `dialogCount: 0` — the fingerprint of #773, a modal that never opened —
  // for a failure whose cause is the row scrape inside a modal that opened
  // fine.  `asserts the modal is still open` below pins that ordering.

  const originalEnv = process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;

  /**
   * Drive `getPostEngagers` to the contradicted-scrape failure: the modal
   * header reports `totalReactions`, the engager scrape yields nothing.
   *
   * @param totalReactions - The cardinal the modal header reports.  `> 0`
   *   with an empty scrape is the contradiction; `0` corroborates the empty
   *   list and must stay legal.
   */
  function setupMocks(totalReactions: number) {
    vi.mocked(discoverTargets).mockResolvedValue([
      {
        id: "target-1",
        type: "page",
        title: "LinkedIn",
        url: "https://www.linkedin.com/feed/",
        description: "",
        devtoolsFrontendUrl: "",
      },
    ]);

    const evaluateMock = vi.fn();
    evaluateMock.mockResolvedValueOnce(true); // post readiness
    evaluateMock.mockResolvedValueOnce(true); // reactions element found
    evaluateMock.mockResolvedValueOnce(true); // modal readiness
    evaluateMock.mockResolvedValueOnce(totalReactions);
    evaluateMock.mockResolvedValueOnce([]); // the empty scrape
    // The collect loop only stops scrolling once a scroll declines: an empty
    // scrape never reaches `targetCount`, so without this the loop would eat
    // the capture's own probe as a scroll result.
    evaluateMock.mockResolvedValueOnce(false); // scroll declines
    evaluateMock.mockResolvedValueOnce(CAPTURE_PROBE);

    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn().mockResolvedValue({ data: "aGVsbG8=" }),
      } as unknown as CDPClient;
    });

    return { evaluateMock };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) {
      delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    } else {
      process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = originalEnv;
    }
  });

  it("writes a diagnostic bundle when the engager scrape contradicts itself", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupMocks(2);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // The propagated error must still be the extraction contract's, not one
    // manufactured by the capture machinery — a bare `.toThrow()` would pass
    // either way.
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(ExtractionFailedError);

    const paths = vi.mocked(writeFile).mock.calls.map((call) => String(call[0]));
    expect(paths.some((path) => path.endsWith(".json"))).toBe(true);
    // Named for the failure that actually happened: the modal readiness gate
    // went green, so `wait-for-reactions-modal` would be the wrong label.
    expect(
      paths.every((path) =>
        path.includes("reactions-modal-extraction-failure-"),
      ),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("stamps the trigger into the bundle and the warn line", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupMocks(2);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    const jsonCall = vi
      .mocked(writeFile)
      .mock.calls.find((call) => String(call[0]).endsWith(".json"));
    expect(jsonCall).toBeDefined();
    // Artifacts get copied out of their mkdtemp directory; a bundle that
    // cannot say what it was capturing leaves its reader guessing.
    expect(
      JSON.parse(String(jsonCall?.[1])) as Record<string, unknown>,
    ).toMatchObject({ trigger: "extraction-failure", dialogCount: 1 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toContain(String(jsonCall?.[0]).replace(/\.json$/, ""));
    expect(message).toContain("extraction-failure diagnostics");
    warnSpy.mockRestore();
  });

  it("is default-off: writes nothing when LHREMOTE_CAPTURE_DIAGNOSTICS is unset", async () => {
    delete process.env.LHREMOTE_CAPTURE_DIAGNOSTICS;
    setupMocks(2);

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow();

    // The bundle contains engager names and profile slugs — personal data.
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("does not capture when the scrape is not contradicted", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    // A post with genuinely zero reactions is legal and must return normally.
    // Guards against the capture degenerating into fire-on-every-empty.
    setupMocks(0);

    const result = await getPostEngagers({
      postUrl: POST_URL,
      cdpPort: CDP_PORT,
    });

    expect(result.engagers).toEqual([]);
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("captures while the modal is still open, before Escape dismisses it", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    const { evaluateMock } = setupMocks(2);
    const sendCalls: string[] = [];
    vi.mocked(CDPClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        navigate: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateMock,
        send: vi.fn(async (method: string) => {
          sendCalls.push(method);
          return { data: "aGVsbG8=" };
        }),
      } as unknown as CDPClient;
    });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(ExtractionFailedError);

    // No Escape was dispatched at all on the failure path, so the screenshot
    // and the modal-scoped probes describe the modal that actually failed.
    expect(sendCalls).not.toContain("Input.dispatchKeyEvent");
    expect(sendCalls).toContain("Page.captureScreenshot");
    warnSpy.mockRestore();
  });

  it("keeps propagating the caller's error when the capture itself fails", async () => {
    process.env.LHREMOTE_CAPTURE_DIAGNOSTICS = "1";
    setupMocks(2);
    const { writeFile: wf } = await import("node:fs/promises");
    vi.mocked(wf).mockRejectedValueOnce(new Error("disk full"));

    // A capture-side failure must never replace the diagnosis it was written
    // to explain.
    await expect(
      getPostEngagers({ postUrl: POST_URL, cdpPort: CDP_PORT }),
    ).rejects.toThrow(ExtractionFailedError);
  });
});
