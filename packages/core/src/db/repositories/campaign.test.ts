import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseClient } from "../client.js";
import {
  ActionNotFoundError,
  CampaignNotFoundError,
  ExcludeListNotFoundError,
  NoNextActionError,
} from "../errors.js";
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
      expect(campaigns).toHaveLength(4);
      expect(campaigns.map((c) => c.id)).not.toContain(3);
    });

    it("includes archived campaigns when requested", () => {
      const campaigns = repo.listCampaigns({ includeArchived: true });

      expect(campaigns).toHaveLength(5);
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

  describe("fixIsValid", () => {
    it("sets is_valid to 1 for a campaign with NULL is_valid", () => {
      // Insert a campaign with is_valid = NULL (as created by the API)
      db.exec(
        `INSERT INTO campaigns (id, name, type, is_valid, li_account_id)
         VALUES (99, 'API-Created Campaign', 1, NULL, 1)`,
      );

      const before = repo.getCampaign(99);
      expect(before.isValid).toBeNull();
      expect(before.state).toBe("active");

      repo.fixIsValid(99);

      const after = repo.getCampaign(99);
      expect(after.isValid).toBe(true);
      expect(after.state).toBe("active");
    });

    it("sets is_valid to 1 for a campaign with is_valid = 0", () => {
      const before = repo.getCampaign(4);
      expect(before.isValid).toBe(false);

      repo.fixIsValid(4);

      const after = repo.getCampaign(4);
      expect(after.isValid).toBe(true);
    });
  });

  describe("createActionExcludeLists", () => {
    it("creates exclude list chain for each action", () => {
      // Campaign 2 has one action (id=2) with action_version (id=2)
      // Verify no exclude_list_id initially
      const before = db
        .prepare(
          "SELECT exclude_list_id FROM action_versions WHERE action_id = 2",
        )
        .all() as Array<{ exclude_list_id: number | null }>;
      expect(before[0]?.exclude_list_id).toBeNull();

      repo.createActionExcludeLists(2, 1);

      // Verify exclude_list_id is now set
      const after = db
        .prepare(
          "SELECT exclude_list_id FROM action_versions WHERE action_id = 2",
        )
        .all() as Array<{ exclude_list_id: number | null }>;
      expect(after[0]?.exclude_list_id).not.toBeNull();

      // Verify the chain: action_versions.exclude_list_id -> CPV -> collection
      const cpvId = after.at(0)?.exclude_list_id;
      expect(cpvId).toBeDefined();

      const cpv = db
        .prepare(
          "SELECT id, collection_id, version_operation_status FROM collection_people_versions WHERE id = ?",
        )
        .get(cpvId as number) as {
        id: number;
        collection_id: number;
        version_operation_status: string;
      };
      expect(cpv).toBeDefined();
      expect(cpv.version_operation_status).toBe("addToTarget");

      const collection = db
        .prepare(
          "SELECT id, li_account_id FROM collections WHERE id = ?",
        )
        .get(cpv.collection_id) as { id: number; li_account_id: number };
      expect(collection).toBeDefined();
      expect(collection.li_account_id).toBe(1);
    });

    it("creates separate exclude lists per action", () => {
      // Add a second action to campaign 1
      db.exec(`
        INSERT INTO action_configs (id, actionType, coolDown, maxActionResultsPerIteration, isDraft)
        VALUES (99, 'VisitAndExtract', 60000, 10, 0);
        INSERT INTO actions (id, campaign_id, name)
        VALUES (99, 1, 'Second Action');
        INSERT INTO action_versions (id, action_id, config_id)
        VALUES (99, 99, 99);
      `);

      repo.createActionExcludeLists(1, 1);

      // Both actions should have distinct exclude_list_ids
      const av1 = db
        .prepare(
          "SELECT exclude_list_id FROM action_versions WHERE action_id = 1",
        )
        .get() as { exclude_list_id: number };
      const av99 = db
        .prepare(
          "SELECT exclude_list_id FROM action_versions WHERE action_id = 99",
        )
        .get() as { exclude_list_id: number };

      expect(av1.exclude_list_id).not.toBeNull();
      expect(av99.exclude_list_id).not.toBeNull();
      expect(av1.exclude_list_id).not.toBe(av99.exclude_list_id);
    });

    it("handles campaign with no actions", () => {
      // Campaign 3 has no actions
      expect(() => repo.createActionExcludeLists(3, 1)).not.toThrow();
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.createActionExcludeLists(999, 1)).toThrow(
        CampaignNotFoundError,
      );
    });

    it("uses the provided liAccountId for collections", () => {
      repo.createActionExcludeLists(1, 5);

      const av = db
        .prepare(
          "SELECT exclude_list_id FROM action_versions WHERE action_id = 1",
        )
        .get() as { exclude_list_id: number };

      const cpv = db
        .prepare(
          "SELECT collection_id FROM collection_people_versions WHERE id = ?",
        )
        .get(av.exclude_list_id) as { collection_id: number };

      const collection = db
        .prepare("SELECT li_account_id FROM collections WHERE id = ?")
        .get(cpv.collection_id) as { li_account_id: number };

      expect(collection.li_account_id).toBe(5);
    });
  });

  describe("updateCampaign", () => {
    it("updates campaign name", () => {
      const updated = repo.updateCampaign(1, { name: "New Name" });

      expect(updated.id).toBe(1);
      expect(updated.name).toBe("New Name");
      expect(updated.description).toBe("Test outreach campaign");
    });

    it("updates campaign description", () => {
      const updated = repo.updateCampaign(1, {
        description: "New description",
      });

      expect(updated.id).toBe(1);
      expect(updated.name).toBe("Outreach Campaign");
      expect(updated.description).toBe("New description");
    });

    it("clears campaign description with null", () => {
      const updated = repo.updateCampaign(1, { description: null });

      expect(updated.id).toBe(1);
      expect(updated.description).toBeNull();
    });

    it("updates both name and description", () => {
      const updated = repo.updateCampaign(1, {
        name: "Updated",
        description: "Updated desc",
      });

      expect(updated.name).toBe("Updated");
      expect(updated.description).toBe("Updated desc");
    });

    it("returns unchanged campaign when no fields provided", () => {
      const updated = repo.updateCampaign(1, {});

      expect(updated.name).toBe("Outreach Campaign");
      expect(updated.description).toBe("Test outreach campaign");
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.updateCampaign(999, { name: "X" })).toThrow(
        CampaignNotFoundError,
      );
    });

    it("preserves other campaign fields", () => {
      const before = repo.getCampaign(1);
      const updated = repo.updateCampaign(1, { name: "Changed" });

      expect(updated.state).toBe(before.state);
      expect(updated.liAccountId).toBe(before.liAccountId);
      expect(updated.isPaused).toBe(before.isPaused);
      expect(updated.isArchived).toBe(before.isArchived);
      expect(updated.isValid).toBe(before.isValid);
      expect(updated.createdAt).toBe(before.createdAt);
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

  describe("moveToNextAction", () => {
    // Campaign 5 has 3 actions: action 5 (VisitAndExtract) → action 6 (Waiter) → action 7 (InvitePerson)
    // Person 1 is queued (state=1) in action 5, person 3 is processed (state=2) in action 5

    it("moves person from current action to next action", () => {
      const result = repo.moveToNextAction(5, 5, [1]);

      expect(result.nextActionId).toBe(6);

      // Person 1 should be marked successful (state=3) in action 5
      const currentTarget = db
        .prepare(
          "SELECT state FROM action_target_people WHERE action_id = 5 AND person_id = 1",
        )
        .get() as { state: number };
      expect(currentTarget.state).toBe(3);

      // Person 1 should be queued (state=1) in action 6
      const nextTarget = db
        .prepare(
          "SELECT state FROM action_target_people WHERE action_id = 6 AND person_id = 1",
        )
        .get() as { state: number };
      expect(nextTarget.state).toBe(1);
    });

    it("moves person from middle action to last action", () => {
      // First insert person 1 into action 6 (middle) so we can move to action 7
      db.exec(
        `INSERT INTO action_target_people (action_id, action_version_id, person_id, state, li_account_id)
         VALUES (6, 6, 1, 2, 1)`,
      );

      const result = repo.moveToNextAction(5, 6, [1]);

      expect(result.nextActionId).toBe(7);

      // Person 1 should be marked successful (state=3) in action 6
      const currentTarget = db
        .prepare(
          "SELECT state FROM action_target_people WHERE action_id = 6 AND person_id = 1",
        )
        .get() as { state: number };
      expect(currentTarget.state).toBe(3);

      // Person 1 should be queued (state=1) in action 7
      const nextTarget = db
        .prepare(
          "SELECT state FROM action_target_people WHERE action_id = 7 AND person_id = 1",
        )
        .get() as { state: number };
      expect(nextTarget.state).toBe(1);
    });

    it("handles multiple persons in a single move", () => {
      const result = repo.moveToNextAction(5, 5, [1, 3]);

      expect(result.nextActionId).toBe(6);

      // Both persons should be successful in action 5
      const targets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 5",
        )
        .all() as Array<{ person_id: number; state: number }>;
      const stateByPerson = new Map(targets.map((t) => [t.person_id, t.state]));
      expect(stateByPerson.get(1)).toBe(3);
      expect(stateByPerson.get(3)).toBe(3);

      // Both should be queued in action 6
      const nextTargets = db
        .prepare(
          "SELECT person_id, state FROM action_target_people WHERE action_id = 6",
        )
        .all() as Array<{ person_id: number; state: number }>;
      expect(nextTargets).toHaveLength(2);
      const nextStateByPerson = new Map(
        nextTargets.map((t) => [t.person_id, t.state]),
      );
      expect(nextStateByPerson.get(1)).toBe(1);
      expect(nextStateByPerson.get(3)).toBe(1);
    });

    it("requeues person already in next action target list", () => {
      // Insert person 1 into action 6 with state=2 (already processed)
      db.exec(
        `INSERT INTO action_target_people (action_id, action_version_id, person_id, state, li_account_id)
         VALUES (6, 6, 1, 2, 1)`,
      );

      repo.moveToNextAction(5, 5, [1]);

      // Person 1 should be requeued (state=1) in action 6
      const target = db
        .prepare(
          "SELECT state FROM action_target_people WHERE action_id = 6 AND person_id = 1",
        )
        .get() as { state: number };
      expect(target.state).toBe(1);
    });

    it("throws NoNextActionError for last action", () => {
      expect(() => repo.moveToNextAction(5, 7, [1])).toThrow(NoNextActionError);
    });

    it("throws ActionNotFoundError for invalid action", () => {
      expect(() => repo.moveToNextAction(5, 999, [1])).toThrow(
        ActionNotFoundError,
      );
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.moveToNextAction(999, 5, [1])).toThrow(
        CampaignNotFoundError,
      );
    });

    it("handles empty person list gracefully", () => {
      const result = repo.moveToNextAction(5, 5, []);
      expect(result.nextActionId).toBe(0);
    });
  });

  describe("getExcludeList", () => {
    // Campaign 1 has campaign-level exclude list with person 2 pre-populated
    // Campaign 5 has campaign-level exclude list (empty) and action-level lists (empty)

    it("returns campaign-level exclude list", () => {
      const entries = repo.getExcludeList(1);

      expect(entries).toEqual([{ personId: 2 }]);
    });

    it("returns empty list when no people excluded", () => {
      const entries = repo.getExcludeList(5);

      expect(entries).toEqual([]);
    });

    it("returns action-level exclude list", () => {
      const entries = repo.getExcludeList(1, 1);

      // Action 1's exclude list (collection 2) has no people
      expect(entries).toEqual([]);
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.getExcludeList(999)).toThrow(CampaignNotFoundError);
    });

    it("throws ActionNotFoundError for action not in campaign", () => {
      expect(() => repo.getExcludeList(1, 999)).toThrow(ActionNotFoundError);
    });

    it("throws ExcludeListNotFoundError when campaign has no exclude list chain", () => {
      // Campaign 2 has no campaign_versions entry
      expect(() => repo.getExcludeList(2)).toThrow(ExcludeListNotFoundError);
    });

    it("returns entries ordered by person_id", () => {
      // Add multiple people to campaign 1's exclude list
      db.exec(`
        INSERT INTO collection_people (collection_id, person_id) VALUES (1, 3);
        INSERT INTO collection_people (collection_id, person_id) VALUES (1, 1);
      `);

      const entries = repo.getExcludeList(1);

      expect(entries.map((e) => e.personId)).toEqual([1, 2, 3]);
    });
  });

  describe("addToExcludeList", () => {
    it("adds people to campaign-level exclude list", () => {
      const added = repo.addToExcludeList(1, [1, 3]);

      expect(added).toBe(2);

      // Verify in database
      const entries = repo.getExcludeList(1);
      expect(entries.map((e) => e.personId)).toContain(1);
      expect(entries.map((e) => e.personId)).toContain(3);
    });

    it("skips already-excluded people", () => {
      // Person 2 is already in campaign 1's exclude list
      const added = repo.addToExcludeList(1, [2, 3]);

      expect(added).toBe(1); // Only person 3 was newly added

      const entries = repo.getExcludeList(1);
      expect(entries).toHaveLength(2); // Person 2 (existing) + person 3 (new)
    });

    it("adds people to action-level exclude list", () => {
      const added = repo.addToExcludeList(1, [1], 1);

      expect(added).toBe(1);

      const entries = repo.getExcludeList(1, 1);
      expect(entries).toEqual([{ personId: 1 }]);
    });

    it("returns 0 for empty person list", () => {
      const added = repo.addToExcludeList(1, []);

      expect(added).toBe(0);
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.addToExcludeList(999, [1])).toThrow(
        CampaignNotFoundError,
      );
    });

    it("throws ActionNotFoundError for action not in campaign", () => {
      expect(() => repo.addToExcludeList(1, [1], 999)).toThrow(
        ActionNotFoundError,
      );
    });

    it("throws ExcludeListNotFoundError when exclude list chain missing", () => {
      expect(() => repo.addToExcludeList(2, [1])).toThrow(
        ExcludeListNotFoundError,
      );
    });
  });

  describe("removeFromExcludeList", () => {
    it("removes people from campaign-level exclude list", () => {
      // Person 2 is in campaign 1's exclude list
      const removed = repo.removeFromExcludeList(1, [2]);

      expect(removed).toBe(1);

      const entries = repo.getExcludeList(1);
      expect(entries).toEqual([]);
    });

    it("returns 0 for people not in the list", () => {
      const removed = repo.removeFromExcludeList(1, [999]);

      expect(removed).toBe(0);
    });

    it("removes people from action-level exclude list", () => {
      // First add a person to action 1's exclude list
      repo.addToExcludeList(1, [1], 1);

      const removed = repo.removeFromExcludeList(1, [1], 1);

      expect(removed).toBe(1);

      const entries = repo.getExcludeList(1, 1);
      expect(entries).toEqual([]);
    });

    it("handles mixed present and absent people", () => {
      // Person 2 is in the list, person 999 is not
      const removed = repo.removeFromExcludeList(1, [2, 999]);

      expect(removed).toBe(1);
    });

    it("returns 0 for empty person list", () => {
      const removed = repo.removeFromExcludeList(1, []);

      expect(removed).toBe(0);
    });

    it("throws CampaignNotFoundError for missing campaign", () => {
      expect(() => repo.removeFromExcludeList(999, [1])).toThrow(
        CampaignNotFoundError,
      );
    });

    it("throws ActionNotFoundError for action not in campaign", () => {
      expect(() => repo.removeFromExcludeList(1, [1], 999)).toThrow(
        ActionNotFoundError,
      );
    });

    it("throws ExcludeListNotFoundError when exclude list chain missing", () => {
      expect(() => repo.removeFromExcludeList(2, [1])).toThrow(
        ExcludeListNotFoundError,
      );
    });
  });
});
