// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { DatabaseClient } from "../client.js";
import { openFixture } from "../testing/open-fixture.js";
import { CampaignRepository } from "./campaign.js";
import { CampaignNotFoundError } from "../errors.js";

describe("CampaignRepository.deleteCampaign (integration)", () => {
  let rawDb: DatabaseSync;
  let client: DatabaseClient;
  let repo: CampaignRepository;

  beforeAll(() => {
    // Use openFixture() for an isolated writable copy
    rawDb = openFixture();

    // Pause campaign 1 so it can be hard-deleted
    // (fixture has it as active: is_paused=0, is_archived=0, is_valid=1)
    rawDb.exec("UPDATE campaigns SET is_paused = 1 WHERE id = 1");

    // Wrap the raw DatabaseSync in a DatabaseClient for the repo
    client = { db: rawDb, close: () => rawDb.close() } as unknown as DatabaseClient;
    repo = new CampaignRepository(client);
  });

  afterAll(() => {
    rawDb.close();
  });

  function countRows(table: string, where: string, params: number[]): number {
    const row = rawDb.prepare(
      `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${where}`,
    ).get(...params) as { cnt: number };
    return row.cnt;
  }

  it("removes campaign 1 and all related rows", () => {
    // Pre-conditions: campaign 1 has data in all related tables
    expect(countRows("campaigns", "id = ?", [1])).toBe(1);
    expect(countRows("actions", "campaign_id = ?", [1])).toBeGreaterThan(0);
    expect(countRows("action_versions", "action_id IN (SELECT id FROM actions WHERE campaign_id = ?)", [1])).toBeGreaterThan(0);
    expect(countRows("action_target_people", "action_id IN (SELECT id FROM actions WHERE campaign_id = ?)", [1])).toBeGreaterThan(0);
    expect(countRows("action_results", "action_version_id IN (SELECT av.id FROM action_versions av JOIN actions a ON av.action_id = a.id WHERE a.campaign_id = ?)", [1])).toBeGreaterThan(0);
    expect(countRows("person_in_campaigns_history", "campaign_id = ?", [1])).toBeGreaterThan(0);
    expect(countRows("campaign_versions", "campaign_id = ?", [1])).toBeGreaterThan(0);

    // Perform the hard delete
    repo.deleteCampaign(1);

    // Post-conditions: all related rows are gone
    expect(countRows("campaigns", "id = ?", [1])).toBe(0);
    expect(countRows("actions", "campaign_id = ?", [1])).toBe(0);
    expect(countRows("action_versions", "action_id IN (SELECT id FROM actions WHERE campaign_id = ?)", [1])).toBe(0);
    expect(countRows("action_target_people", "action_id IN (SELECT id FROM actions WHERE campaign_id = ?)", [1])).toBe(0);
    expect(countRows("action_results", "action_version_id IN (SELECT av.id FROM action_versions av JOIN actions a ON av.action_id = a.id WHERE a.campaign_id = ?)", [1])).toBe(0);
    expect(countRows("action_result_flags", "action_result_id IN (SELECT ar.id FROM action_results ar JOIN action_versions av ON ar.action_version_id = av.id JOIN actions a ON av.action_id = a.id WHERE a.campaign_id = ?)", [1])).toBe(0);
    expect(countRows("action_result_messages", "action_result_id IN (SELECT ar.id FROM action_results ar JOIN action_versions av ON ar.action_version_id = av.id JOIN actions a ON av.action_id = a.id WHERE a.campaign_id = ?)", [1])).toBe(0);
    expect(countRows("person_in_campaigns_history", "campaign_id = ?", [1])).toBe(0);
    expect(countRows("campaign_versions", "campaign_id = ?", [1])).toBe(0);
  });

  it("throws CampaignNotFoundError for non-existent campaign", () => {
    expect(() => repo.deleteCampaign(9999)).toThrow(CampaignNotFoundError);
  });

  it("does not affect other campaigns", () => {
    // Campaign 2 should still exist after deleting campaign 1
    expect(countRows("campaigns", "id = ?", [2])).toBe(1);
    expect(countRows("actions", "campaign_id = ?", [2])).toBeGreaterThan(0);
  });
});
