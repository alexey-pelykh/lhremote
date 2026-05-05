// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, expect, it } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  getE2ECompanyUrl,
  getE2EProfileUrl,
  installErrorDetection,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@lhremote/core/testing";
import {
  type AppService,
  discoverInstancePort,
  discoverTargets,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";
import type { UnfollowProfileOutput } from "@lhremote/core";

// MCP tool registrations
import { registerUnfollowProfile } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("unfollow-profile operation", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let cdpPort: number;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    const launcher = new LauncherService(port);
    try {
      await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
      await startInstanceWithRecovery(launcher, accountId, port);
    } finally {
      launcher.disconnect();
    }

    const instancePort = await retryAsync(
      async () => {
        const p = await discoverInstancePort(port);
        if (p === null) throw new Error("Instance CDP port not discovered yet");
        return p;
      },
      { retries: 10, delay: 2_000 },
    );
    cdpPort = instancePort;

    await retryAsync(
      async () => {
        const targets = await discoverTargets(cdpPort);
        const hasLinkedIn = targets.some(
          (t) => t.type === "page" && t.url?.includes("linkedin.com"),
        );
        if (!hasLinkedIn) {
          throw new Error("LinkedIn target not available yet");
        }
      },
      { retries: 30, delay: 2_000 },
    );
  }, 120_000);

  installErrorDetection(() => port);

  afterAll(async () => {
    const launcher = new LauncherService(port);
    try {
      await launcher.connect();
      await forceStopInstance(launcher, accountId, port);
    } catch {
      // Best-effort cleanup
    } finally {
      launcher.disconnect();
    }
    await quitApp(app);
  }, 60_000);

  it(
    "unfollow-profile dryRun detects follow state without mutating",
    async () => {
      const profileUrl = getE2EProfileUrl();

      const { server, getHandler } = createMockServer();
      registerUnfollowProfile(server);
      const handler = getHandler("unfollow-profile");

      const result = (await handler({
        profileUrl,
        cdpPort,
        dryRun: true,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(
        result.isError,
        `MCP tool error: ${result.content[0]?.text ?? "no content"}`,
      ).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as UnfollowProfileOutput;

      expect(parsed.success).toBe(true);
      expect(parsed.profileUrl).toBe(profileUrl);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.targetKind).toBe("profile");
      expect(parsed.publicId.length).toBeGreaterThan(0);
      expect(["following", "not_following", "unknown"]).toContain(parsed.priorState);

      if (parsed.priorState === "following") {
        // When following, dryRun opens the confirmation dialog and records
        // the name, but does not click Unfollow.  The name is still captured.
        expect(parsed.unfollowedName).not.toBeNull();
        expect((parsed.unfollowedName ?? "").length).toBeGreaterThan(0);
      } else {
        // When not following or unknown, no click/name extraction happens.
        expect(parsed.unfollowedName).toBeNull();
      }
    },
    180_000,
  );

  it(
    "unfollow-profile dryRun detects follow state on a /company/ URL without mutating",
    async () => {
      // ADR-007 (2026-04-29 amendment) extends the readiness selector and
      // Following/Follow aria-label detection from member profiles to
      // company pages.  This E2E test is the empirical verification that
      // the analytic premise holds against rendered company-page DOM.
      // Set LHREMOTE_E2E_COMPANY_URL to any LinkedIn organization URL
      // (e.g. https://www.linkedin.com/company/mirohq/) to enable.
      const companyUrl = getE2ECompanyUrl();

      const { server, getHandler } = createMockServer();
      registerUnfollowProfile(server);
      const handler = getHandler("unfollow-profile");

      const result = (await handler({
        profileUrl: companyUrl,
        cdpPort,
        dryRun: true,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(
        result.isError,
        `MCP tool error: ${result.content[0]?.text ?? "no content"}`,
      ).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as UnfollowProfileOutput;

      expect(parsed.success).toBe(true);
      expect(parsed.profileUrl).toBe(companyUrl);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.targetKind).toBe("company");
      expect(parsed.publicId.length).toBeGreaterThan(0);
      // ADR-007's amended premise (2026-04-29) is that the readiness
      // selector and Following/Follow aria-label detection work on
      // company pages.  "unknown" fires only when neither button is
      // visible — i.e., the premise is violated.  Fail fast with an
      // explicit message so the regression surfaces clearly instead of
      // hiding behind a permissive `toContain` set.  Diagnostic capture
      // in navigate-to-company-{ts}-{slug}.{json,png} is the evidence
      // path; inspect those artifacts before relaxing this assertion.
      expect(
        parsed.priorState,
        `Detection returned "unknown" on company page ${companyUrl} — ` +
          `ADR-007's amended premise (Follow/Following toggle works on ` +
          `company pages) was violated.  Inspect the diagnostic capture ` +
          `under \${os.tmpdir()}/lhremote-diagnostics-*/navigate-to-company-*.{json,png} ` +
          `(per-invocation mkdtemp directory; the helper's console.warn ` +
          `reports the actual path).`,
      ).not.toBe("unknown");
      expect(["following", "not_following"]).toContain(parsed.priorState);

      if (parsed.priorState === "following") {
        expect(parsed.unfollowedName).not.toBeNull();
        expect((parsed.unfollowedName ?? "").length).toBeGreaterThan(0);
      } else {
        expect(parsed.unfollowedName).toBeNull();
      }
    },
    180_000,
  );
});
