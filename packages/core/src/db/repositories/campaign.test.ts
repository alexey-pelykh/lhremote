import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseClient } from "../client.js";
import { CampaignNotFoundError } from "../errors.js";
import { openFixture } from "../testing/open-fixture.js";
import { CampaignRepository } from "./campaign.js";

describe("CampaignRepository", () => {
  let db: DatabaseSync;
  let client: DatabaseClient;
  let repo: CampaignRepository;

  beforeEach(() => {
    db = openFixture();
    client = { db } as DatabaseClient;
    repo = new CampaignRepository(client);
  });

  afterEach(() => {
    db.close();
  });

  describe("listCampaigns", () => {
    it("returns non-archived campaigns by default", () => {
      const campaigns = repo.listCampaigns();

      // Should not include archived campaign (id=3)
      expect(campaigns).toHaveLength(3);
      expect(campaigns.map((c) => c.id)).not.toContain(3);
    });

    it("includes archived campaigns when requested", () => {
      const campaigns = repo.listCampaigns({ includeArchived: true });

      expect(campaigns).toHaveLength(4);
      expect(campaigns.map((c) => c.id)).toContain(3);
    });

    it("returns correct campaign summary fields", () => {
      const campaigns = repo.listCampaigns({ includeArchived: true });
      const outreach = campaigns.find((c) => c.id === 1);

      expect(outreach).toBeDefined();
      expect(outreach).toMatchObject({
        name: "Outreach Campaign",
        description: "Test outreach campaign",
        state: "active",
        liAccountId: 1,
        actionCount: 1,
      });
      expect(outreach?.createdAt).toBeDefined();
    });

    it("derives correct state for different campaigns", () => {
      const campaigns = repo.listCampaigns({ includeArchived: true });

      const stateById = new Map(campaigns.map((c) => [c.id, c.state]));
      expect(stateById.get(1)).toBe("active");
      expect(stateById.get(2)).toBe("paused");
      expect(stateById.get(3)).toBe("archived");
      expect(stateById.get(4)).toBe("invalid");
    });

    it("returns campaigns ordered by created_at descending", () => {
      const campaigns = repo.listCampaigns();

      // Most recent first
      const ids = campaigns.map((c) => c.id);
      expect(ids.at(0)).toBe(1); // 2025-01-15
      expect(ids.at(1)).toBe(2); // 2025-01-14
    });
  });

  describe("getCampaign", () => {
    it("returns a fully populated campaign", () => {
      const campaign = repo.getCampaign(1);

      expect(campaign.id).toBe(1);
      expect(campaign.name).toBe("Outreach Campaign");
      expect(campaign.description).toBe("Test outreach campaign");
      expect(campaign.state).toBe("active");
      expect(campaign.liAccountId).toBe(1);
      expect(campaign.isPaused).toBe(false);
      expect(campaign.isArchived).toBe(false);
      expect(campaign.isValid).toBe(true);
      expect(campaign.createdAt).toBeDefined();
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.getCampaign(999)).toThrow(CampaignNotFoundError);
      expect(() => repo.getCampaign(999)).toThrow(
        "Campaign not found for id 999",
      );
    });

    it("handles paused campaign", () => {
      const campaign = repo.getCampaign(2);

      expect(campaign.state).toBe("paused");
      expect(campaign.isPaused).toBe(true);
    });

    it("handles archived campaign", () => {
      const campaign = repo.getCampaign(3);

      expect(campaign.state).toBe("archived");
      expect(campaign.isArchived).toBe(true);
    });

    it("handles invalid campaign", () => {
      const campaign = repo.getCampaign(4);

      expect(campaign.state).toBe("invalid");
      expect(campaign.isValid).toBe(false);
    });
  });

  describe("getCampaignActions", () => {
    it("returns all actions for a campaign", () => {
      const actions = repo.getCampaignActions(1);

      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        id: 1,
        campaignId: 1,
        name: "Send Welcome Message",
        description: "First touch message",
        versionId: 1,
      });
    });

    it("returns action config with parsed settings", () => {
      const actions = repo.getCampaignActions(1);
      expect(actions).toHaveLength(1);
      const action = actions.at(0);
      expect(action).toBeDefined();

      expect(action?.config.id).toBe(1);
      expect(action?.config.actionType).toBe("MessageToPerson");
      expect(action?.config.coolDown).toBe(60000);
      expect(action?.config.maxActionResultsPerIteration).toBe(10);
      expect(action?.config.isDraft).toBe(false);
      expect(action?.config.actionSettings).toHaveProperty("messageTemplate");
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.getCampaignActions(999)).toThrow(CampaignNotFoundError);
    });

    it("returns empty array for campaign with no actions", () => {
      const actions = repo.getCampaignActions(3);
      expect(actions).toHaveLength(0);
    });
  });

  describe("getResults", () => {
    it("returns action results for a campaign", () => {
      const results = repo.getResults(1);

      expect(results).toHaveLength(1);
      const result = results.at(0);
      expect(result).toBeDefined();
      expect(result).toMatchObject({
        id: 1,
        actionVersionId: 1,
        personId: 1,
        result: 1,
        platform: "LINKEDIN",
      });
      expect(result?.createdAt).toBeDefined();
    });

    it("respects limit parameter", () => {
      const results = repo.getResults(1, { limit: 1 });
      expect(results).toHaveLength(1);
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.getResults(999)).toThrow(CampaignNotFoundError);
    });

    it("returns empty array for campaign with no results", () => {
      const results = repo.getResults(2);
      expect(results).toHaveLength(0);
    });
  });

  describe("getCampaignState", () => {
    it("returns active state for active campaign", () => {
      const state = repo.getCampaignState(1);
      expect(state).toBe("active");
    });

    it("returns paused state for paused campaign", () => {
      const state = repo.getCampaignState(2);
      expect(state).toBe("paused");
    });

    it("returns archived state for archived campaign", () => {
      const state = repo.getCampaignState(3);
      expect(state).toBe("archived");
    });

    it("returns invalid state for invalid campaign", () => {
      const state = repo.getCampaignState(4);
      expect(state).toBe("invalid");
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.getCampaignState(999)).toThrow(CampaignNotFoundError);
    });
  });

  describe("resetForRerun", () => {
    it("resets person state for re-run", () => {
      // Initial state: person 1 has state=2 (processed), person 3 has state=1 (queued)
      const initialTargets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 1",
        )
        .all() as Array<{ person_id: number; state: number }>;

      const initialPerson1 = initialTargets.find((t) => t.person_id === 1);
      expect(initialPerson1).toBeDefined();
      expect(initialPerson1?.state).toBe(2);

      // Reset person 1
      repo.resetForRerun(1, [1]);

      // Verify state reset to 1 (queued)
      const afterTargets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 1",
        )
        .all() as Array<{ person_id: number; state: number }>;

      const afterPerson1 = afterTargets.find((t) => t.person_id === 1);
      expect(afterPerson1).toBeDefined();
      expect(afterPerson1?.state).toBe(1);
    });

    it("resets campaign history for re-run", () => {
      // Initial state: person 1 has result_status=1 (success)
      const initialHistory = db
        .prepare(
          "SELECT result_status FROM person_in_campaigns_history WHERE campaign_id = 1 AND person_id = 1",
        )
        .get() as { result_status: number } | undefined;

      expect(initialHistory).toBeDefined();
      expect(initialHistory?.result_status).toBe(1);

      // Reset person 1
      repo.resetForRerun(1, [1]);

      // Verify result_status reset to -999
      const afterHistory = db
        .prepare(
          "SELECT result_status FROM person_in_campaigns_history WHERE campaign_id = 1 AND person_id = 1",
        )
        .get() as { result_status: number } | undefined;

      expect(afterHistory).toBeDefined();
      expect(afterHistory?.result_status).toBe(-999);
    });

    it("deletes old action results and related records", () => {
      // Verify initial state has results
      const initialResults = db
        .prepare(
          "SELECT id FROM action_results WHERE action_version_id = 1 AND person_id = 1",
        )
        .all() as Array<{ id: number }>;
      expect(initialResults).toHaveLength(1);

      const initialFlags = db
        .prepare(
          "SELECT id FROM action_result_flags WHERE action_result_id = 1",
        )
        .all();
      expect(initialFlags).toHaveLength(1);

      const initialMessages = db
        .prepare(
          "SELECT id FROM action_result_messages WHERE action_result_id = 1",
        )
        .all();
      expect(initialMessages).toHaveLength(1);

      // Reset person 1
      repo.resetForRerun(1, [1]);

      // Verify all deleted
      const afterResults = db
        .prepare(
          "SELECT id FROM action_results WHERE action_version_id = 1 AND person_id = 1",
        )
        .all();
      expect(afterResults).toHaveLength(0);

      const afterFlags = db
        .prepare(
          "SELECT id FROM action_result_flags WHERE action_result_id = 1",
        )
        .all();
      expect(afterFlags).toHaveLength(0);

      const afterMessages = db
        .prepare(
          "SELECT id FROM action_result_messages WHERE action_result_id = 1",
        )
        .all();
      expect(afterMessages).toHaveLength(0);
    });

    it("handles multiple persons in a single reset", () => {
      repo.resetForRerun(1, [1, 3]);

      // Both persons should have state=1
      const targets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 1",
        )
        .all() as Array<{ person_id: number; state: number }>;

      const stateByPerson = new Map(targets.map((t) => [t.person_id, t.state]));
      expect(stateByPerson.get(1)).toBe(1);
      expect(stateByPerson.get(3)).toBe(1);
    });

    it("handles empty person list gracefully", () => {
      // Should not throw
      expect(() => repo.resetForRerun(1, [])).not.toThrow();
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.resetForRerun(999, [1])).toThrow(CampaignNotFoundError);
    });

    it("handles campaign with no actions gracefully", () => {
      // Campaign 3 has no actions
      expect(() => repo.resetForRerun(3, [1])).not.toThrow();
    });
  });
});
