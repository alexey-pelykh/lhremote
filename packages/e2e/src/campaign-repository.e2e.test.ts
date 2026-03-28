// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, expect, it } from "vitest";
import { describeE2E, launchApp, quitApp, resolveAccountId } from "@lhremote/core/testing";
import {
  AppService,
  CampaignRepository,
  DatabaseClient,
  discoverDatabase,
  type CampaignSummary,
} from "@lhremote/core";

describeE2E("CampaignRepository", () => {
  let app: AppService;
  let port: number;
  let dbClient: DatabaseClient;
  let repo: CampaignRepository;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    const accountId = await resolveAccountId(port);
    const dbPath = discoverDatabase(accountId);
    dbClient = new DatabaseClient(dbPath);
    repo = new CampaignRepository(dbClient);
  }, 60_000);

  afterAll(async () => {
    dbClient?.close();
    await quitApp(app);
  }, 30_000);

  it("listCampaigns() returns campaigns with expected shape", () => {
    const campaigns = repo.listCampaigns({ includeArchived: true });
    expect(campaigns.length).toBeGreaterThan(0);
    for (const campaign of campaigns) {
      expect(campaign).toHaveProperty("id");
      expect(campaign).toHaveProperty("name");
      expect(typeof campaign.name).toBe("string");
      expect(campaign).toHaveProperty("state");
      expect(["active", "paused", "archived", "invalid"]).toContain(campaign.state);
      expect(campaign).toHaveProperty("liAccountId");
      expect(typeof campaign.actionCount).toBe("number");
      expect(campaign.actionCount).toBeGreaterThanOrEqual(0);
      expect(campaign).toHaveProperty("createdAt");
    }
  });

  it("getCampaign() returns full campaign details", () => {
    const campaigns = repo.listCampaigns({ includeArchived: true });
    expect(campaigns.length, "No campaigns found in database").toBeGreaterThan(0);
    const campaign = repo.getCampaign((campaigns[0] as CampaignSummary).id);
    expect(campaign).toHaveProperty("id");
    expect(campaign).toHaveProperty("name");
    expect(campaign).toHaveProperty("state");
    expect(typeof campaign.isPaused).toBe("boolean");
    expect(typeof campaign.isArchived).toBe("boolean");
    expect(campaign.isValid === null || typeof campaign.isValid === "boolean").toBe(true);
    expect(campaign).toHaveProperty("createdAt");
  });

  it("getCampaignActions() returns actions with parsed config", () => {
    const campaigns = repo.listCampaigns({ includeArchived: true });
    const withActions = campaigns.find((c) => c.actionCount > 0);
    if (!withActions) {
      console.log("  skipping: no campaigns with actions found");
      return;
    }
    const actions = repo.getCampaignActions(withActions.id);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).toHaveProperty("id");
      expect(action).toHaveProperty("campaignId");
      expect(action.campaignId).toBe(withActions.id);
      expect(action).toHaveProperty("name");
      expect(typeof action.name).toBe("string");
      expect(action).toHaveProperty("config");
      expect(action.config).toHaveProperty("actionType");
      expect(typeof action.config.actionType).toBe("string");
      expect(action.config).toHaveProperty("actionSettings");
      expect(typeof action.config.actionSettings).toBe("object");
      expect(action).toHaveProperty("versionId");
    }
  });

  it("getResults() returns results with expected shape", () => {
    const campaigns = repo.listCampaigns({ includeArchived: true });
    const withActions = campaigns.find((c) => c.actionCount > 0);
    if (!withActions) {
      console.log("  skipping: no campaigns with actions found");
      return;
    }
    const results = repo.getResults(withActions.id, { limit: 10 });
    for (const result of results) {
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("actionVersionId");
      expect(result).toHaveProperty("personId");
      expect(typeof result.result).toBe("number");
      expect(result).toHaveProperty("createdAt");
    }
  });
});
